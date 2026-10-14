// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Outil de Ph, sur son PC (spec 14.33 A) :
//   node outils/publier.ts creer-cle <fichier-hors-depot>
//       crée la paire de signature des listes ; la clé privée est écrite chiffrée ; seule la clé publique est affichée.
//   node outils/publier.ts cle-publique <fichier>
//       affiche la clé publique (non secrète) d'un fichier de clé.
//   node outils/publier.ts publier --export <export.json> --cle <fichier> --sortie <dossier> [--oui]
//       valide l'export du back-office, affiche la différence avec la publication précédente, demande la phrase
//       de passe, signe officiels.json et frauduleux.json et les écrit dans le dossier de sortie.
// La phrase de passe est saisie sans écho (ou, pour les essais seulement, TMT_PHRASE_DE_PASSE). Rien de secret n'est
// jamais affiché ni écrit en clair. Aucun fichier n'est envoyé nulle part : la publication reste un geste de Ph.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { estAppeleDirectement } from './cli.ts';
import { creerFichierCle, lireClePrivee, type FichierCle } from './cle.ts';
import { construirePublication, differences, validerExport, versionSuivante, type ListePubliee } from './publication.ts';

/* v8 ignore start -- exécuté dans un sous-processus par publier-integration.test.ts ; la couverture v8 ne voit pas les enfants. */
function lirePhrase(question: string): Promise<string> {
  if (process.env.TMT_PHRASE_DE_PASSE) return Promise.resolve(process.env.TMT_PHRASE_DE_PASSE);
  if (!process.stdin.isTTY) throw new Error('la phrase de passe se saisit dans un terminal (sans écho)');
  return new Promise((ok) => {
    process.stdout.write(question);
    let saisie = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const lire = (c: string): void => {
      for (const car of c) {
        if (car === '\r' || car === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', lire);
          process.stdout.write('\n');
          ok(saisie);
          return;
        }
        if (car === '\u0003') process.exit(130);
        saisie = car === '\u007f' ? saisie.slice(0, -1) : saisie + car;
      }
    };
    process.stdin.on('data', lire);
  });
}

function option(args: string[], nom: string): string | undefined {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
}

function lireJson<T>(chemin: string): T | null {
  return existsSync(chemin) ? (JSON.parse(readFileSync(chemin, 'utf8')) as T) : null;
}

async function main(): Promise<void> {
  const [commande, ...args] = process.argv.slice(2);
  const racineDepot = resolve(import.meta.dirname, '..', '..');
  if (commande === 'creer-cle') {
    const chemin = resolve(args[0] ?? '');
    if (!args[0]) throw new Error('Usage : node outils/publier.ts creer-cle <fichier>');
    if (chemin.startsWith(racineDepot + sep)) throw new Error('le fichier de clé doit être HORS du dépôt');
    if (existsSync(chemin)) throw new Error('ce fichier existe déjà : il n\'est jamais écrasé');
    const phrase = await lirePhrase('Phrase de passe (12 caractères au moins) : ');
    if (!process.env.TMT_PHRASE_DE_PASSE && (await lirePhrase('Répétez la phrase de passe : ')) !== phrase) throw new Error('les deux saisies diffèrent');
    const fichier = creerFichierCle(phrase);
    writeFileSync(chemin, JSON.stringify(fichier, null, 2), { encoding: 'utf8', flag: 'wx' });
    console.log(`Clé privée chiffrée écrite dans ${chemin}. Elle ne doit jamais entrer dans le dépôt ni sur le serveur.`);
    console.log(`Clé publique (à donner au build, TOURMENTIN_CLE_PUBLIQUE_LISTES) : ${fichier.publique}`);
    return;
  }
  if (commande === 'cle-publique') {
    if (!args[0]) throw new Error('Usage : node outils/publier.ts cle-publique <fichier>');
    console.log((JSON.parse(readFileSync(args[0], 'utf8')) as FichierCle).publique);
    return;
  }
  if (commande === 'publier') {
    const cheminExport = option(args, '--export');
    const cheminCle = option(args, '--cle');
    const sortie = option(args, '--sortie');
    if (!cheminExport || !cheminCle || !sortie) throw new Error('Usage : node outils/publier.ts publier --export <export.json> --cle <fichier> --sortie <dossier> [--oui]');
    const socle = JSON.parse(readFileSync(join(racineDepot, 'listes', 'publie', 'socle.json'), 'utf8')) as { entrees: { id: string }[] };
    const { export: exp, problemes } = validerExport(JSON.parse(readFileSync(cheminExport, 'utf8')), new Set(socle.entrees.map((e) => e.id)));
    if (!exp) {
      console.error('Export refusé :\n- ' + problemes.join('\n- '));
      process.exit(1);
    }
    const avantO = lireJson<ListePubliee<{ hote: string; marque?: string; statut?: string }>>(join(sortie, 'officiels.json'));
    const avantF = lireJson<ListePubliee<{ hote: string }>>(join(sortie, 'frauduleux.json'));
    const maintenant = new Date();
    const versions = { officiels: versionSuivante(avantO?.version ?? null, maintenant), frauduleux: versionSuivante(avantF?.version ?? null, maintenant) };
    const dO = differences(avantO?.entrees ?? [], exp.officiels.map((e) => ({ hote: e.hote, ...(e.marque ? { marque: e.marque } : {}), ...(e.statut ? { statut: e.statut } : {}) })));
    const dF = differences(avantF?.entrees ?? [], exp.frauduleux);
    console.log(`officiels : version ${versions.officiels}, ${exp.officiels.length} entrées (+${dO.ajoutes.length} −${dO.retires.length} ~${dO.modifies.length})`);
    // au-delà de 50 lignes par rubrique (import du corpus : des milliers), un résumé : la différence reste lisible
    const montrer = (signe: string, hotes: string[]): void => {
      for (const h of hotes.slice(0, 50)) console.log(`  ${signe} ${h}`);
      if (hotes.length > 50) console.log(`  ${signe} … et ${hotes.length - 50} autres`);
    };
    montrer('+', dO.ajoutes);
    montrer('−', dO.retires);
    montrer('~', dO.modifies);
    console.log(`frauduleux : version ${versions.frauduleux}, ${exp.frauduleux.length} entrées (+${dF.ajoutes.length} −${dF.retires.length})`);
    montrer('+', dF.ajoutes);
    montrer('−', dF.retires);
    const nbRep = exp.officiels.filter((e) => e.statut === 'repertorie').length;
    console.log(`  dont ${exp.officiels.length - nbRep} validé(s) et ${nbRep} répertorié(s)`);
    if (!args.includes('--oui')) {
      const lecteur = createInterface({ input: process.stdin, output: process.stdout });
      const rep = (await lecteur.question('Signer et écrire ces deux fichiers ? (oui/non) ')).trim().toLowerCase();
      lecteur.close();
      if (rep !== 'oui') throw new Error('abandon : rien n\'est écrit');
    }
    const phrase = await lirePhrase('Phrase de passe de la clé : ');
    const cle = lireClePrivee(JSON.parse(readFileSync(cheminCle, 'utf8')) as FichierCle, phrase);
    const pub = construirePublication(exp, versions, maintenant, cle);
    mkdirSync(sortie, { recursive: true });
    // compact : quelques milliers de répertoriés (14.44) ; la mise en forme n'entre pas dans les octets signés
    writeFileSync(join(sortie, 'officiels.json'), JSON.stringify(pub.officiels) + '\n', 'utf8');
    writeFileSync(join(sortie, 'frauduleux.json'), JSON.stringify(pub.frauduleux) + '\n', 'utf8');
    console.log(`Écrit dans ${sortie}. À publier par vos soins : aucun envoi n'est fait par cet outil.`);
    return;
  }
  throw new Error('commandes : creer-cle, cle-publique, publier');
}

if (estAppeleDirectement(import.meta.url)) {
  main().catch((e: Error) => {
    console.error('Erreur : ' + e.message);
    process.exit(1);
  });
}
/* v8 ignore stop */
