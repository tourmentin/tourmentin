// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';

function docDe(html: string, url = 'https://exemple.fr/page'): Document {
  return new JSDOM(html, { url }).window.document;
}

describe('construireEntreeAnalyse — url', () => {
  it('positif : domaine enregistrable, sous-domaines et chemin corrects', () => {
    const doc = docDe('<p>rien</p>', 'https://cfspart.impots.gouv.fr/connexion?a=1');
    expect(doc.defaultView).not.toBeNull();
    const entree = construireEntreeAnalyse(doc);
    expect(entree.url).toMatchObject({
      hote: 'cfspart.impots.gouv.fr',
      domaineEnregistrable: 'impots.gouv.fr',
      suffixePublic: 'gouv.fr',
      sousDomaines: ['cfspart'],
      chemin: '/connexion',
      schema: 'https',
      estAdresseIp: false,
    });
  });

  it('cas limite : adresse IP littérale', () => {
    const entree = construireEntreeAnalyse(docDe('<p>x</p>', 'http://203.0.113.5/admin'));
    expect(entree.url?.estAdresseIp).toBe(true);
  });
});

describe('construireEntreeAnalyse — texte visible', () => {
  it('exclut script, style, noscript et les éléments masqués', () => {
    const doc = docDe(`
      <body>
        <p>Espace Particulier visible</p>
        <p style="display:none">jamais affiché</p>
        <p style="visibility:hidden">invisible aussi</p>
        <p hidden>caché par l'attribut</p>
        <script>console.log('secret de script')</script>
        <style>.x{color:red}</style>
        <noscript>contenu noscript</noscript>
      </body>`);
    const entree = construireEntreeAnalyse(doc);
    expect(entree.texteVisible).toContain('Espace Particulier visible');
    for (const absent of ['jamais affiché', 'invisible aussi', "caché par l'attribut", 'secret de script', 'color:red', 'contenu noscript']) {
      expect(entree.texteVisible).not.toContain(absent);
    }
  });

  it('cas limite : tronqué à 20 000 caractères, le début est conservé', () => {
    const debut = 'Espace Particulier ';
    const doc = docDe(`<p>${debut}${'a'.repeat(25_000)}</p>`);
    const entree = construireEntreeAnalyse(doc);
    expect(entree.texteVisible.length).toBe(20_000);
    expect(entree.texteVisible.startsWith(debut)).toBe(true);
  });

  it('lit le contenu d\'une shadow root ouverte', () => {
    const doc = docDe('<div id="hote"></div>');
    const hote = doc.getElementById('hote')!;
    const racine = hote.attachShadow({ mode: 'open' });
    racine.innerHTML = '<p>Numéro fiscal requis</p>';
    const entree = construireEntreeAnalyse(doc);
    expect(entree.texteVisible).toContain('Numéro fiscal requis');
  });
});

describe('construireEntreeAnalyse — formulaires : aucune valeur de champ ne traverse', () => {
  it("positif : la longueur est transmise, jamais le contenu (règle 2 de CLAUDE.md, C7)", () => {
    const doc = docDe(`
      <form>
        <label for="mdp">Mot de passe</label>
        <input id="mdp" type="password" name="mdp" autocomplete="current-password">
      </form>`);
    const champ = doc.getElementById('mdp') as HTMLInputElement;
    champ.value = 'hunter2-secret';

    const entree = construireEntreeAnalyse(doc);
    const serialise = JSON.stringify(entree);

    expect(serialise).not.toContain('hunter2-secret');
    const formulaire = entree.formulaires[0]!;
    expect(formulaire.champs[0]).toMatchObject({
      type: 'password',
      nom: 'mdp',
      libelle: 'Mot de passe',
      autocomplete: 'current-password',
      visible: true,
      longueurSaisie: 'hunter2-secret'.length,
    });
    expect(typeof formulaire.champs[0]!.longueurSaisie).toBe('number');
  });

  it('négatif : champ sans saisie, longueurSaisie à 0', () => {
    const doc = docDe('<form><input type="text" name="q"></form>');
    expect(construireEntreeAnalyse(doc).formulaires[0]!.champs[0]!.longueurSaisie).toBe(0);
  });

  it('cas limite : select n\'a pas de longueurSaisie', () => {
    const doc = docDe('<form><select name="s"><option value="a">A</option></select></form>');
    expect(construireEntreeAnalyse(doc).formulaires[0]!.champs[0]!.longueurSaisie).toBeUndefined();
  });

  it('cas limite : champ type=hidden ou display:none n\'est pas visible', () => {
    const doc = docDe(`
      <form>
        <input type="hidden" name="jeton" value="abc">
        <input type="text" name="masque" style="display:none">
      </form>`);
    const champs = construireEntreeAnalyse(doc).formulaires[0]!.champs;
    expect(champs.every((c) => c.visible === false)).toBe(true);
  });

  it('libellé résolu via aria-label puis aria-labelledby à défaut de <label>', () => {
    const doc = docDe(`
      <form>
        <input type="text" name="a" aria-label="Numéro de sécurité sociale">
        <span id="lbl">Code confidentiel</span>
        <input type="text" name="b" aria-labelledby="lbl">
      </form>`);
    const champs = construireEntreeAnalyse(doc).formulaires[0]!.champs;
    expect(champs[0]!.libelle).toBe('Numéro de sécurité sociale');
    expect(champs[1]!.libelle).toBe('Code confidentiel');
  });

  it('cas limite : aria-labelledby référence un id inexistant → pas de libellé, pas d\'exception', () => {
    const doc = docDe('<form><input type="text" name="c" aria-labelledby="absent"></form>');
    expect(construireEntreeAnalyse(doc).formulaires[0]!.champs[0]!.libelle).toBeUndefined();
  });

  it('formulaire dans une shadow root : ses champs sont collectés', () => {
    const doc = docDe('<div id="hote"></div>');
    const racine = doc.getElementById('hote')!.attachShadow({ mode: 'open' });
    racine.innerHTML = '<form><input type="password" name="mdp"></form>';
    expect(construireEntreeAnalyse(doc).formulaires).toHaveLength(1);
  });
});

describe('construireEntreeAnalyse — action du formulaire (E6)', () => {
  it('positif : action vers un autre domaine, résolue en absolu', () => {
    const doc = docDe('<form action="https://attaquant.com/vole"></form>', 'https://impots.gouv.fr/page');
    expect(construireEntreeAnalyse(doc).formulaires[0]!.actionDomaineEnregistrable).toBe('attaquant.com');
  });

  it('négatif : action relative, même domaine', () => {
    const doc = docDe('<form action="/valider"></form>', 'https://impots.gouv.fr/page');
    expect(construireEntreeAnalyse(doc).formulaires[0]!.actionDomaineEnregistrable).toBe('impots.gouv.fr');
  });

  it('cas limite : pas d\'action → non résolue (soumission vers la page courante)', () => {
    const doc = docDe('<form></form>', 'https://impots.gouv.fr/page');
    expect(construireEntreeAnalyse(doc).formulaires[0]!.actionDomaineEnregistrable).toBeUndefined();
  });

  it('cas limite : action vers un protocole non http(s) → non résolue', () => {
    const doc = docDe('<form action="tel:+33100000000"></form>', 'https://impots.gouv.fr/page');
    expect(construireEntreeAnalyse(doc).formulaires[0]!.actionDomaineEnregistrable).toBeUndefined();
  });

  it('cas limite : action relative sans document de référence pour la résoudre → non résolue, pas d\'exception', () => {
    const doc = new JSDOM('').window.document.implementation.createHTMLDocument('sans fenêtre');
    doc.body.innerHTML = '<form action="/valider"></form>';
    expect(doc.location).toBeNull();
    expect(construireEntreeAnalyse(doc).formulaires[0]!.actionDomaineEnregistrable).toBeUndefined();
  });

  it('dansIframeCrossOrigin est toujours faux au niveau de l\'adaptateur (résolu par le service worker)', () => {
    const doc = docDe('<form></form>');
    expect(construireEntreeAnalyse(doc).formulaires[0]!.dansIframeCrossOrigin).toBe(false);
  });
});

describe('construireEntreeAnalyse — liens', () => {
  it('positif : lien http(s) avec domaine enregistrable', () => {
    const doc = docDe('<a href="https://impots.gouv.fr/accueil">Impots</a>');
    const lien = construireEntreeAnalyse(doc).liens[0]!;
    expect(lien).toMatchObject({ texteAffiche: 'Impots', domaineEnregistrable: 'impots.gouv.fr' });
  });

  it('négatif : mailto et javascript ignorés', () => {
    const doc = docDe('<a href="mailto:a@b.fr">Mail</a><a href="javascript:void(0)">JS</a>');
    expect(construireEntreeAnalyse(doc).liens).toHaveLength(0);
  });

  it('cas limite : href relatif sans document de référence pour le résoudre → lien ignoré, pas d\'exception', () => {
    const doc = new JSDOM('').window.document.implementation.createHTMLDocument('sans fenêtre');
    doc.body.innerHTML = '<a href="/page">x</a>';
    expect(construireEntreeAnalyse(doc).liens).toHaveLength(0);
  });
});

describe('construireEntreeAnalyse — formulaires implicites, champs hors <form> (12.3.3.7)', () => {
  it('positif : type password hors <form>', () => {
    const doc = docDe('<div><input type="password" name="p"></div>');
    const champs = construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs);
    expect(champs).toHaveLength(1);
    expect(champs[0]!.type).toBe('password');
  });

  it('positif : type email hors <form>, accompagné d\'un autre champ (pas isolé)', () => {
    const doc = docDe('<div><input type="email" name="e"><input type="password" name="p"></div>');
    const champs = construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs);
    expect(champs.map((c) => c.type).sort()).toEqual(['email', 'password']);
  });

  it('positif : autocomplete=one-time-code hors <form>', () => {
    const doc = docDe('<div><input type="text" autocomplete="one-time-code" name="otp"></div>');
    expect(construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs)).toHaveLength(1);
  });

  it('positif : libellé correspondant à un terme de saisie d\'une empreinte (numéro de sécurité sociale)', () => {
    const doc = docDe('<div><label for="i">Numéro de sécurité sociale</label><input id="i" type="text"></div>');
    const champs = construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs);
    expect(champs).toHaveLength(1);
  });

  it('négatif : type=search écarté', () => {
    const doc = docDe('<div><input type="search" name="q"></div>');
    expect(construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs)).toHaveLength(0);
  });

  it('négatif : champ dans un élément role=search écarté même avec un type retenu', () => {
    const doc = docDe('<div role="search"><input type="email" name="e"></div>');
    expect(construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs)).toHaveLength(0);
  });

  it('négatif : name/id de recherche (q, s, query, search, recherche) écartés', () => {
    for (const nom of ['q', 's', 'query', 'search', 'recherche']) {
      const doc = docDe(`<div><input type="text" name="${nom}"></div>`);
      expect(construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs), `name="${nom}"`).toHaveLength(0);
    }
  });

  it('négatif : champ masqué (display:none) hors <form> écarté', () => {
    const doc = docDe('<div><input type="password" name="p" style="display:none"></div>');
    expect(construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs)).toHaveLength(0);
  });

  it('négatif : champ de taille déclarée nulle écarté', () => {
    const doc = docDe('<div><input type="password" name="p" style="width:0px;height:0px"></div>');
    expect(construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs)).toHaveLength(0);
  });

  it('négatif : lettre d\'information isolée (un seul champ email, aucun autre champ, aucun terme d\'empreinte) écartée', () => {
    const doc = docDe('<div><input type="email" name="newsletter" placeholder="Votre e-mail"></div>');
    expect(construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs)).toHaveLength(0);
  });

  it('positif : un seul champ password isolé N\'EST PAS écarté par la règle de la lettre d\'information (elle ne vise que email/tel)', () => {
    const doc = docDe('<div><input type="password" name="p"></div>');
    expect(construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs)).toHaveLength(1);
  });

  it('regroupement : deux champs proches (même conteneur) forment un seul formulaire implicite', () => {
    const doc = docDe('<div id="boite"><input type="email" name="e"><input type="password" name="p"></div>');
    const entree = construireEntreeAnalyse(doc);
    expect(entree.formulaires).toHaveLength(1);
    expect(entree.formulaires[0]!.champs).toHaveLength(2);
  });

  it('regroupement : deux champs sans ancêtre commun significatif (seulement <body>) forment deux formulaires implicites distincts', () => {
    const doc = docDe('<header><input type="password" name="p1"></header><footer><input type="password" name="p2"></footer>');
    const entree = construireEntreeAnalyse(doc);
    expect(entree.formulaires).toHaveLength(2);
    expect(entree.formulaires.map((f) => f.champs.length)).toEqual([1, 1]);
  });

  it('un formulaire implicite n\'a pas d\'actionDomaineEnregistrable ni d\'iframe cross-origin (pas de balise <form>)', () => {
    const doc = docDe('<div><input type="password" name="p"></div>');
    expect(construireEntreeAnalyse(doc).formulaires[0]).toMatchObject({ actionDomaineEnregistrable: undefined, dansIframeCrossOrigin: false });
  });

  it('un champ déjà dans un <form> réel n\'est jamais recompté comme candidat implicite', () => {
    const doc = docDe('<form><input type="password" name="p"></form>');
    const entree = construireEntreeAnalyse(doc);
    expect(entree.formulaires).toHaveLength(1);
    expect(entree.formulaires[0]!.champs).toHaveLength(1);
  });
});

describe('construireEntreeAnalyse — formulaires implicites, cas limites de couverture', () => {
  it('un champ sans aucune raison de rétention (ni type, ni autocomplete, ni terme de saisie) est écarté sans déclencher la règle de la lettre isolée', () => {
    const doc = docDe('<div><input type="text" name="numero_client"><input type="password" name="p"></div>');
    const champs = construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs);
    expect(champs.map((c) => c.type)).toEqual(['password']);
  });

  it('un champ sans libellé, name ni placeholder (rien à comparer au lexique) est écarté', () => {
    const doc = docDe('<div><input type="text"><input type="password" name="p"></div>');
    const champs = construireEntreeAnalyse(doc).formulaires.flatMap((f) => f.champs);
    expect(champs.map((c) => c.type)).toEqual(['password']);
  });

  it('deux champs dans deux racines d\'ombre distinctes, sans ancêtre commun (au-delà de la frontière d\'ombre) : deux formulaires implicites', () => {
    const doc = docDe('<div id="a"></div><div id="b"></div>');
    const hoteA = doc.getElementById('a')!;
    const hoteB = doc.getElementById('b')!;
    const ombreA = hoteA.attachShadow({ mode: 'open' });
    const ombreB = hoteB.attachShadow({ mode: 'open' });
    ombreA.innerHTML = '<input type="password" name="p1">';
    ombreB.innerHTML = '<input type="password" name="p2">';
    const entree = construireEntreeAnalyse(doc);
    expect(entree.formulaires).toHaveLength(2);
    expect(entree.formulaires.map((f) => f.champs.length)).toEqual([1, 1]);
  });
});
