/**
 * Moteur de calcul d'honoraires
 * Gère les règles de cumul/non-cumul NGAP et calcule les totaux
 * Basé sur le NGAP version 14/02/2026
 */
const Engine = (() => {
  let tarifs = null;

  function setTarifs(data) {
    tarifs = data;
  }

  function getTarifs() {
    return tarifs;
  }

  function getZone() {
    return localStorage.getItem('hon_zone') || 'metro';
  }

  function getGeo() {
    return localStorage.getItem('hon_geo') || 'plaine';
  }

  function getActeTarif(acteCode) {
    if (!tarifs) return 0;
    const acte = tarifs.consultations[acteCode];
    if (!acte) return 0;
    const zone = getZone();
    return acte.tarifs[zone] || acte.tarifs.metro || 0;
  }

  // ============================================================
  // Règles NGAP de cumul/non-cumul
  // ============================================================

  /**
   * Actes considérés comme "complexes" (art. 15.8/15.9)
   * Non cumulables avec MCG et MEG
   */
  const ACTES_COMPLEXES = ['APC', 'GL1', 'GL2', 'GL3', 'VL', 'VSP'];

  /**
   * Actes pédiatriques — grisés si patient adulte
   */
  const ACTES_PEDIATRIQUES = ['COE', 'COB', 'COD'];

  /**
   * Composants facturés 100% AMO (pas de part AMC)
   */
  const CODES_AMO100 = [
    'F', 'MN', 'MM',
    'CRN', 'CRM', 'CRD', 'CRS',
    'VRN', 'VRM', 'VRD', 'VRS',
    'SNP',
    'COE', 'COB', 'COD'
  ];

  /**
   * Détermine les majorations disponibles selon le contexte complet
   * Retourne un objet { code: { available: bool, reason: string } }
   */
  function getAvailableMajos(acte, age, periode, mode, isVisite, deplacement, activeMajos) {
    if (!tarifs) return {};
    const result = {};
    const isRegule = mode === 'regule';
    const isHorsJour = periode !== 'jour';
    const isComplex = ACTES_COMPLEXES.includes(acte);

    for (const [code, majo] of Object.entries(tarifs.majorations)) {
      let available = true;
      let reason = '';

      // 1. Vérifier applicableTo (art. 14.7 MEG, art. 2bis MCG, etc.)
      if (majo.applicableTo && !majo.applicableTo.includes(acte)) {
        available = false;
        reason = `Non applicable à ${acte}`;
      }

      // 2. MEG : uniquement enfant <6 ans (art. 14.7)
      if (available && code === 'MEG' && age !== 'enfant') {
        available = false;
        reason = 'Réservé aux enfants 0-6 ans';
      }

      // 3. MCG : non cumulable avec consultations complexes (art. 2bis, 15.8, 15.9)
      if (available && code === 'MCG' && isComplex) {
        available = false;
        reason = `Non cumulable avec ${acte} (consultation complexe)`;
      }

      // 4. MEG : non cumulable avec consultations complexes (art. 15.8, 15.9)
      //    et non cumulable avec COE/COB/COD (art. 14.9)
      if (available && code === 'MEG') {
        if (isComplex) {
          available = false;
          reason = `Non cumulable avec ${acte} (consultation complexe)`;
        } else if (ACTES_PEDIATRIQUES.includes(acte)) {
          available = false;
          reason = `Non cumulable avec ${acte} (art. 14.9)`;
        }
      }

      // 5. SNP : non cumulable avec PDSA (art. 14.1.3)
      if (available && code === 'SNP' && isRegule) {
        available = false;
        reason = 'Non cumulable avec majorations PDSA (art. 14.1.3)';
      }

      // 6. SNP : non cumulable avec F/MN/MM (majorations d'urgence art. 14)
      if (available && code === 'SNP' && isHorsJour && !isRegule) {
        available = false;
        reason = 'Non cumulable avec majorations horaires non régulées (art. 14.1.3)';
      }

      // 7. MHP : non cumulable avec PDSA (art. 22-4)
      if (available && code === 'MHP' && isRegule) {
        available = false;
        reason = 'Non cumulable avec majorations PDSA (art. 22-4)';
      }

      // 8. MHP : non cumulable avec F/MN/MM (art. 22-4)
      if (available && code === 'MHP' && isHorsJour && !isRegule) {
        available = false;
        reason = 'Non cumulable avec F/MN/MM (art. 22-4)';
      }

      // 9. MHP : non cumulable avec MDN/MDD en visite (art. 22-4)
      if (available && code === 'MHP' && isVisite && (deplacement === 'MDN' || deplacement === 'MDD')) {
        available = false;
        reason = `Non cumulable avec ${deplacement} (art. 22-4)`;
      }

      // 10. MUT : non cumulable avec PDSA (art. 14.1.6)
      if (available && code === 'MUT' && isRegule) {
        available = false;
        reason = 'Non cumulable avec majorations PDSA (art. 14.1.6)';
      }

      // 11. MSH/MIC : en visite, non cumulable avec MDN/MDD (art. 15.5)
      if (available && (code === 'MSH' || code === 'MIC') && isVisite && (deplacement === 'MDN' || deplacement === 'MDD')) {
        available = false;
        reason = `Non cumulable avec ${deplacement} en visite (art. 15.5)`;
      }

      // 12. Exclusifs mutuels (MSH/MIC/MIS, SNP/MCG, SNP/MHP)
      if (available && majo.exclusifs && activeMajos) {
        for (const ex of majo.exclusifs) {
          if (activeMajos.includes(ex)) {
            available = false;
            reason = `Non cumulable avec ${ex}`;
            break;
          }
        }
      }

      // Vérifier aussi l'exclusion dans l'autre sens
      if (available && activeMajos) {
        for (const activeCode of activeMajos) {
          if (activeCode === code) continue;
          const activeMajo = tarifs.majorations[activeCode];
          if (activeMajo?.exclusifs?.includes(code)) {
            available = false;
            reason = `Non cumulable avec ${activeCode}`;
            break;
          }
        }
      }

      result[code] = { available, reason };
    }

    return result;
  }

  /**
   * Vérifie si la majoration horaire est applicable à l'acte
   * TCG : non cumulable avec F/MN/MM (art. 14.9.3) mais PDSA ok
   */
  function isHoraireApplicable(acte, periode, mode) {
    if (periode === 'jour') return false;
    // TCG : pas de F/MN/MM (art. 14.9.3), mais PDSA ok
    if (acte === 'TCG' && mode !== 'regule') return false;
    return true;
  }

  /**
   * Vérifie si le déplacement est applicable en mode régulé
   * Art. 22-3 : PDSA non cumulable avec MD/MDN/MDD (mais IK ok)
   */
  function isDeplacementApplicable(mode) {
    return mode !== 'regule';
  }

  // ============================================================
  // Calcul principal
  // ============================================================

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

    // 2. Majorations (avec règles contextuelles NGAP)
    const activeMajos = filterMajorations(majorations, age, acte, periode, mode, isVisite, deplacement);
    for (const majoCode of activeMajos) {
      const majo = tarifs.majorations[majoCode];
      if (majo) {
        codes.push(majoCode);
        details.push({ code: majoCode, label: majo.label, montant: majo.tarif });
        total += majo.tarif;
      }
    }

    // 3. Majorations horaires (avec vérification TCG)
    if (isHoraireApplicable(acte, periode, mode)) {
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

    // 4. Déplacement (visite uniquement, pas en régulé PDSA - art. 22-3)
    if (isVisite && deplacement && isDeplacementApplicable(mode)) {
      const dep = tarifs.deplacement[deplacement];
      if (dep) {
        const zone = getZone();
        const depTarif = dep.tarifs[zone] || dep.tarifs.metro || 0;
        codes.push(deplacement);
        details.push({ code: deplacement, label: dep.label, montant: depTarif });
        total += depTarif;
      }
    }

    // 5. IK (visite uniquement — toujours cumulable, même en PDSA)
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
      if (ccamResult.replaceConsult) {
        total -= acteTarif;
        details[0].montant = 0;
        details[0].label += ' (non facturé — acte CCAM plus rémunérateur)';
        codes[0] = '(' + codes[0] + ')';
      }
    }

    // Calcul AMO/AMC
    let amo = 0;
    let amc = 0;
    for (const d of details) {
      if (d.montant === 0) continue;
      const code = d.code.replace(/[()]/g, '');
      if (CODES_AMO100.includes(code)) {
        amo += d.montant;
      } else {
        amo += d.montant * 0.7;
        amc += d.montant * 0.3;
      }
    }

    return {
      codes,
      details,
      total: Math.round(total * 100) / 100,
      amo: Math.round(amo * 100) / 100,
      amc: Math.round(amc * 100) / 100
    };
  }

  /**
   * Calcule les actes CCAM avec règles d'association
   */
  function calculateCCAM(ccamActes, consultCode, consultTarif) {
    const items = [];
    let replaceConsult = false;

    const sorted = [...ccamActes].sort((a, b) => b.tarif - a.tarif);

    for (let i = 0; i < Math.min(sorted.length, 2); i++) {
      const acte = sorted[i];
      const cumul = acte.cumulG || 'non';

      if (cumul === 'oui') {
        const taux = i === 0 ? 1 : 0.5;
        const montant = Math.round(acte.tarif * taux * 100) / 100;
        const tauxLabel = taux < 1 ? ` (${Math.round(taux * 100)}%)` : '';
        items.push({ code: acte.code, label: acte.label + tauxLabel, montant });
      } else if (cumul === '50%') {
        const montant = Math.round(acte.tarif * 0.5 * 100) / 100;
        items.push({ code: acte.code, label: acte.label + ' (50%)', montant });
      } else {
        if (acte.tarif > consultTarif) {
          replaceConsult = true;
          items.push({ code: acte.code, label: acte.label, montant: acte.tarif });
        } else {
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
   * Filtre les majorations selon TOUTES les règles NGAP contextuelles
   */
  function filterMajorations(selected, age, acte, periode, mode, isVisite, deplacement) {
    if (!tarifs) return [];
    const isRegule = mode === 'regule';
    const isHorsJour = periode !== 'jour';
    const isComplex = ACTES_COMPLEXES.includes(acte);

    const result = [];
    for (const code of selected) {
      const majo = tarifs.majorations[code];
      if (!majo) continue;

      // MEG : enfant uniquement
      if (code === 'MEG' && age !== 'enfant') continue;

      // applicableTo
      if (majo.applicableTo && !majo.applicableTo.includes(acte)) continue;

      // MCG/MEG : pas avec consultations complexes
      if ((code === 'MCG' || code === 'MEG') && isComplex) continue;

      // MEG : pas avec COE/COB/COD
      if (code === 'MEG' && ACTES_PEDIATRIQUES.includes(acte)) continue;

      // SNP : pas avec PDSA ni F/MN/MM
      if (code === 'SNP' && (isRegule || (isHorsJour && !isRegule))) continue;

      // MHP : pas avec PDSA, F/MN/MM, MDN/MDD
      if (code === 'MHP') {
        if (isRegule) continue;
        if (isHorsJour && !isRegule) continue;
        if (isVisite && (deplacement === 'MDN' || deplacement === 'MDD')) continue;
      }

      // MUT : pas avec PDSA
      if (code === 'MUT' && isRegule) continue;

      // MSH/MIC : pas avec MDN/MDD en visite
      if ((code === 'MSH' || code === 'MIC') && isVisite && (deplacement === 'MDN' || deplacement === 'MDD')) continue;

      // Exclusifs mutuels (MSH/MIC/MIS, SNP/MCG, SNP/MHP)
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
      const map = { 'dimferie': 'VRD', 'nuit': 'VRN', 'nuitprofonde': 'VRM' };
      const code = map[periode];
      if (!code) return null;
      const entry = tarifs.majorationsHoraires.visiteRegulees[code];
      return entry ? { code, label: entry.label, tarif: entry.tarif } : null;
    }

    if (mode === 'regule') {
      const map = { 'dimferie': 'CRD', 'nuit': 'CRN', 'nuitprofonde': 'CRM' };
      const code = map[periode];
      if (!code) return null;
      const entry = tarifs.majorationsHoraires.regulees[code];
      return entry ? { code, label: entry.label, tarif: entry.tarif } : null;
    }

    const map = { 'dimferie': 'F', 'nuit': 'MN', 'nuitprofonde': 'MM' };
    const code = map[periode];
    if (!code) return null;
    const entry = tarifs.majorationsHoraires.nonRegulees[code];
    return entry ? { code, label: entry.label, tarif: entry.tarif } : null;
  }

  /**
   * Calcule l'indemnité kilométrique
   */
  function calculateIK(km) {
    if (!tarifs) return { montant: 0, kmFactures: 0 };

    const geo = getGeo();
    const zone = getZone();
    const ikData = tarifs.ik[geo] || tarifs.ik.plaine;

    const franchise = ikData.franchise_km || 0;
    const tarifKm = ikData.tarifs[zone] || ikData.tarifs.metro || 0;

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
    if (majo1?.exclusifs?.includes(code2)) return true;
    const majo2 = tarifs.majorations[code2];
    if (majo2?.exclusifs?.includes(code1)) return true;
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
    filterMajorations,
    getAvailableMajos,
    isHoraireApplicable,
    isDeplacementApplicable,
    ACTES_COMPLEXES,
    ACTES_PEDIATRIQUES
  };
})();
