// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Observe les requêtes réseau du SERVICE WORKER de l'extension par le protocole DevTools (CDP brut) :
// Playwright ne voit pas le réseau d'un service worker d'extension. C'est la preuve en navigateur
// réel qu'aucune requête ne part avec le réglage « Ne jamais envoyer » (14.26 étape 3).
//
// Se connecte au port de débogage du navigateur (WebSocket intégré à Node) et s'attache AUTOMATIQUEMENT à
// toute cible « service_worker » de l'extension, y compris un service worker redémarré après ses 30 s
// d'inactivité : la cible est mise en pause à sa création, Network est activé, puis elle est relâchée —
// aucune requête ne peut passer inaperçue. Sans cela, une absence de requêtes ne prouverait rien.
export async function observerReseauSW(port, idExtension) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let prochain = 1;
  const attentes = new Map();
  const requetes = [];
  const listes = [];
  const vues = new Set(); // la même cible peut être attachée deux fois (explicite puis automatique) : on dédoublonne par requestId
  let attachements = 0;

  const envoyer = (methode, params = {}, sessionId) => new Promise((resolve) => {
    const id = prochain++;
    attentes.set(id, resolve);
    ws.send(JSON.stringify({ id, method: methode, params, ...(sessionId ? { sessionId } : {}) }));
  });

  ws.onmessage = async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && attentes.has(msg.id)) { attentes.get(msg.id)(msg); attentes.delete(msg.id); return; }
    if (msg.method === 'Network.requestWillBeSent' && !vues.has(msg.params.requestId)) {
      vues.add(msg.params.requestId);
      const q = { url: msg.params.request.url, methode: msg.params.request.method, corps: msg.params.request.postData ?? null };
      // 14.37 point 5 : le téléchargement horaire des listes signées ne dépend pas du réglage d'envoi ; il est compté à part
      // (jamais confondu avec ce que « Ne jamais envoyer » interdit : déclarations, liaison, enregistrement).
      (/^https:\/\/tourmentin\.fr\/listes\/(officiels|frauduleux)\.json$/.test(q.url) && q.methode === 'GET' ? listes : requetes).push(q);
    }
    if (msg.method === 'Target.attachedToTarget') {
      const info = msg.params.targetInfo;
      if (info.type === 'service_worker' && info.url.includes(idExtension)) {
        await envoyer('Network.enable', {}, msg.params.sessionId);
        attachements++;
      }
      // Relâche la cible (mise en pause à sa création) pour qu'elle démarre, Network étant déjà actif.
      await envoyer('Runtime.runIfWaitingForDebugger', {}, msg.params.sessionId);
    }
  };

  await envoyer('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  // Le service worker déjà en cours d'exécution n'est pas « créé » : on s'y attache explicitement.
  const cibles = (await envoyer('Target.getTargets')).result.targetInfos;
  for (const t of cibles.filter((c) => c.type === 'service_worker' && c.url.includes(idExtension))) {
    const { result } = await envoyer('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    await envoyer('Network.enable', {}, result.sessionId);
    attachements++;
  }
  if (attachements === 0) throw new Error('service worker introuvable');
  return {
    requetes: () => [...requetes],
    listes: () => [...listes],
    vider: () => { requetes.length = 0; listes.length = 0; },
    attachements: () => attachements,
    fermer: () => ws.close(),
  };
}
