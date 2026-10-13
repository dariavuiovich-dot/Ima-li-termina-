const { createClient } = require('redis');

function parseInfo(txt) {
  const out = {};
  String(txt || '').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf(':');
    if (i <= 0) return;
    out[t.slice(0, i)] = t.slice(i + 1);
  });
  return out;
}

async function countByPrefix(client, prefix) {
  let cursor = 0;
  let count = 0;
  do {
    const res = await client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 200 });
    cursor = res.cursor;
    count += res.keys.length;
  } while (cursor !== 0);
  return count;
}

(async () => {
  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', () => {});
  await client.connect();

  const dbsize = await client.dbSize();
  const memory = parseInfo(await client.sendCommand(['INFO', 'MEMORY']));
  const stats = parseInfo(await client.sendCommand(['INFO', 'STATS']));

  const prefixes = [
    'kccg:snapshot:',
    'kccg:subscriptions',
    'kccg:notifications:user:',
    'kccg:debug:',
    'kccg:usage:api:'
  ];

  const prefixCounts = {};
  for (const p of prefixes) prefixCounts[p] = await countByPrefix(client, p);

  const result = {
    ok: true,
    dbsize,
    memory: {
      usedBytes: Number(memory.used_memory || 0),
      usedHuman: memory.used_memory_human || null,
      peakHuman: memory.used_memory_peak_human || null,
      rssHuman: memory.used_memory_rss_human || null,
      fragmentation: memory.mem_fragmentation_ratio || null,
    },
    stats: {
      totalCommandsProcessed: Number(stats.total_commands_processed || 0),
      totalConnectionsReceived: Number(stats.total_connections_received || 0),
      expiredKeys: Number(stats.expired_keys || 0),
      evictedKeys: Number(stats.evicted_keys || 0),
      keyspaceHits: Number(stats.keyspace_hits || 0),
      keyspaceMisses: Number(stats.keyspace_misses || 0),
    },
    prefixCounts,
  };

  console.log(JSON.stringify(result, null, 2));
  await client.quit();
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2));
  process.exit(1);
});
