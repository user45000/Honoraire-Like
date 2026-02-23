/**
 * Moteur de calcul d'honoraires
 * Gère les règles de cumul/non-cumul et calcule les totaux
 */
const Engine = (() => {
  let tarifs = null;

  function setTarifs(data) {
    tarifs = data;
  }

  function getTarifs() {
    return tarifs;
  }

  /**
   * Récupère la zone de tarification depuis les paramètres
   */
  function getZone() {
    return localStorage.getItem('hon_zone') || 'metro';
  }

  function getGeo() {
    return localStorage.getItem('hon_geo') || 'plaine';
  }

  /**
   * Calcule le tarif d'un acte selon la zone
   */
  function getActeTarif(acteCode) {
    if (!tarifs) return 0;
    const acte = tarifs.consultations[acteCode];
    if (!acte) return 0;
    const zone = getZone();
    return acte.tarifs[zone] || acte.tarifs.metro || 0;
  }

  /**
   * Calcule une consultation ou visite
   * @param {Object} params
   * @param {string} params.acte - Code acte (G, VG, APC, etc.)
   * @param {string} params.age - "adulte" ou "enfant"
   * @param {string[]} params.majorations - ["MCG", "MEG", ...]
   * @param {string} params.periode - "jour", "dimferie", "nuit", "nuitprofonde"
   * @param {string} params.mode - "nonregule" ou "regule"
   * @param {boolean} params.isVisite - true si visite
   * @param {string} [params.deplacement] - Code déplacement (MD, MDM, etc.)
   * @param {boolean} [params.ikEnabled] - IK activé
   * @param {number} [params.ikKm] - Distance en km
   * @returns {Object} { codes, details, total }
   */
  function calculate(params) {
    if (!tarifs) return { codes: [], details: [], total: 0 };

    const {
      acte, age, majorations = [], periode, mode,
      isVisite = false, deplacement, ikEnabled = false, ikKm = 0,
      ccamActes = []
    } = params;

    const codes = [];
    const details = [];
    let total = 0;

    // 1. Acte de base
    const acteTarif = getActeTarif(acte);
    codes.push(acte);
    details.push({ code: acte, label: tarifs.consultations[acte]?.label || acte, montant: acteTarif });
    total += acteTarif;

    // 2. Majorations (avec règles d'exclusion)
    const activeMajos = filterMajorations(majorations, age, acte);
    for (const majoCode of activeMajos) {
      const majo = tarifs.majorations[majoCode];
      if (majo) {
        codes.push(majoCode);
        details.push({ code: majoCode, label: majo.label, montant: majo.tarif });
        total += majo.tarif;
      }
    }

    // 3. Majorations horaires
    if (periode !== 'jour') {
      const horaireResult = getHoraireMajoration(periode, mode, isVisite);
      if (horaireResult) {
        codes.push(horaireResult.code);
        details.push({
          code: horaireResult.code,
          label: horaireResult.label,
          montant: horaireResult.tarif
        });
        total += horaireResult.tarif;
      }
    }

    // 4. Déplacement (visite uniquement)
    if (isVisite && deplacement) {
      const dep = tarifs.deplacement[deplacement];
      if (dep) {
        const zone = getZone();
        const depTarif = dep.tarifs[zone] || dep.tarifs.metro || 0;
        codes.push(deplacement);
        details.push({ code: deplacement, label: dep.label, montant: depTarif });
        total += depTarif;
      }
    }

    // 5. IK (visite uniquement)
    if (isVisite && ikEnabled && ikKm > 0) {
      const ikResult = calculateIK(ikKm);
      if (ikResult.montant > 0) {
        const ikCode = `${ikResult.kmFactures}IK`;
        codes.push(ikCode);
        details.push({
          code: ikCode,
          label: `Indemnité kilométrique (${ikResult.kmFactures} km facturés)`,
          montant: ikResult.montant
        });
        total += ikResult.montant;
      }
    }

    // 6. Actes CCAM associés
    if (ccamActes && ccamActes.length > 0) {
      const ccamResult = calculateCCAM(ccamActes, acte, acteTarif);
      for (const item of ccamResult.items) {
        codes.push(item.code);
        details.push(item);
        total += item.montant;
      }
      // Si un acte CCAM non cumulable est plus cher que G, remplacer G
      if (ccamResult.replaceConsult) {
        // Retirer l'acte de consultation du total
        total -= acteTarif;
        details[0].montant = 0;
        details[0].label += ' (non facturé — acte CCAM plus rémunérateur)';
        codes[0] = '(' + codes[0] + ')';
      }
    }

    return {
      codes,
      details,
      total: Math.round(total * 100) / 100
    };
  }

  /**
   * Calcule les actes CCAM avec règles d'association
   * - cumulG "oui" : facturé à 100% en sus de G
   * - cumulG "50%" : facturé à 50% en sus de G
   * - cumulG "non" : facturer le plus rémunérateur (G ou CCAM)
   * - 2 actes CCAM : 1er à 100%, 2ème à 50% (max 2)
   */
  function calculateCCAM(ccamActes, consultCode, consultTarif) {
    const items = [];
    let replaceConsult = false;

    // Trier par tarif décroissant (acte principal en premier)
    const sorted = [...ccamActes].sort((a, b) => b.tarif - a.tarif);

    for (let i = 0; i < Math.min(sorted.length, 2); i++) {
      const acte = sorted[i];
      const cumul = acte.cumulG || 'non';

      if (cumul === 'oui') {
        // Cumulable à 100% avec G
        const taux = i === 0 ? 1 : 0.5; // 2ème acte CCAM à 50%
        const montant = Math.round(acte.tarif * taux * 100) / 100;
        const tauxLabel = taux < 1 ? ` (${Math.round(taux * 100)}%)` : '';
        items.push({
          code: acte.code,
          label: acte.label + tauxLabel,
          montant
        });
      } else if (cumul === '50%') {
        // Cumulable à 50% avec G (biopsies)
        const montant = Math.round(acte.tarif * 0.5 * 100) / 100;
        items.push({
          code: acte.code,
          label: acte.label + ' (50%)',
          montant
        });
      } else {
        // Non cumulable : facturer le plus rémunérateur
        if (acte.tarif > consultTarif) {
          replaceConsult = true;
          items.push({
            code: acte.code,
            label: acte.label,
            montant: acte.tarif
          });
        } else {
          // G plus rémunérateur, CCAM à 0
          items.push({
            code: '(' + acte.code + ')',
            label: acte.label + ' (non facturé — G plus rémunérateur)',
            montant: 0
          });
        }
      }
    }

    return { items, replaceConsult };
  }

  /**
   * Filtre les majorations selon les règles d'exclusion
   */
  function filterMajorations(selected, age, acte) {
    if (!tarifs) return [];

    const result = [];
    for (const code of selected) {
      const majo = tarifs.majorations[code];
      if (!majo) continue;

      // MEG uniquement si enfant 0-6 ans
      if (code === 'MEG' && age !== 'enfant') continue;

      // Vérifier applicableTo
      if (majo.applicableTo && !majo.applicableTo.includes(acte)) continue;

      // Vérifier exclusifs (MSH/MIC/MIS mutuellement exclusifs)
      if (majo.exclusifs) {
        const hasConflict = result.some(r => majo.exclusifs.includes(r));
        if (hasConflict) continue;
      }

      result.push(code);
    }
    return result;
  }

  /**
   * Détermine la majoration horaire selon période et mode
   */
  function getHoraireMajoration(periode, mode, isVisite) {
    if (!tarifs) return null;

    if (isVisite && mode === 'regule') {
      const map = {
        'dimferie': 'VRD',
        'nuit': 'VRM',
        'nuitprofonde': 'VRN'
      };
      const code = map[periode];
      if (!code) return null;
      const entry = tarifs.majorationsHoraires.visiteRegulees[code];
      return entry ? { code, label: entry.label, tarif: entry.tarif } : null;
    }

    if (mode === 'regule') {
      const map = {
        'dimferie': 'CRD',
        'nuit': 'CRM',
        'nuitprofonde': 'CRN'
      };
      const code = map[periode];
      if (!code) return null;
      const entry = tarifs.majorationsHoraires.regulees[code];
      return entry ? { code, label: entry.label, tarif: entry.tarif } : null;
    }

    // Non régulé
    const map = {
      'dimferie': 'F',
      'nuit': 'MN',
      'nuitprofonde': 'MM'
    };
    const code = map[periode];
    if (!code) return null;
    const entry = tarifs.majorationsHoraires.nonRegulees[code];
    return entry ? { code, label: entry.label, tarif: entry.tarif } : null;
  }

  /**
   * Calcule l'indemnité kilométrique
   * Formule : (2 * distance - franchise) * tarif_km
   */
  function calculateIK(km) {
    if (!tarifs) return { montant: 0, kmFactures: 0 };

    const geo = getGeo();
    const zone = getZone();
    const ikData = tarifs.ik[geo] || tarifs.ik.plaine;

    const franchise = ikData.franchise_km || 0;
    const tarifKm = ikData.tarifs[zone] || ikData.tarifs.metro || 0;

    // Aller-retour : 2 * distance, moins franchise (en km aller)
    const kmFactures = Math.max(0, 2 * km - franchise);
    const montant = Math.round(kmFactures * tarifKm * 100) / 100;

    return { montant, kmFactures, tarifKm, franchise };
  }

  /**
   * Vérifie si deux majorations sont mutuellement exclusives
   */
  function areExclusive(code1, code2) {
    if (!tarifs) return false;
    const majo1 = tarifs.majorations[code1];
    if (majo1 && majo1.exclusifs && majo1.exclusifs.includes(code2)) return true;
    const majo2 = tarifs.majorations[code2];
    if (majo2 && majo2.exclusifs && majo2.exclusifs.includes(code1)) return true;
    return false;
  }

  /**
   * Retourne les majorations exclues par une majoration donnée
   */
  function getExcludedBy(code) {
    if (!tarifs) return [];
    const majo = tarifs.majorations[code];
    return majo?.exclusifs || [];
  }

  function getCCAMByCode(code) {
    if (!tarifs) return null;
    return (tarifs.ccam || []).find(a => a.code === code) || null;
  }

  return {
    setTarifs,
    getTarifs,
    getZone,
    getGeo,
    getActeTarif,
    calculate,
    calculateIK,
    calculateCCAM,
    getCCAMByCode,
    areExclusive,
    getExcludedBy,
    filterMajorations
  };
})();
