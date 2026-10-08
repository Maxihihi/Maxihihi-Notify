import { fetchText, fetchJson, allXmlEntries, xmlTag, xmlAttr, normalizeHttpUrl } from './common.js';

export async function pollGitHub(source, provider = {}) {
  const { owner, repo } = normalizeRepository(source.target);
  source.resolvedTarget = `${owner}/${repo}`;
  const kind = normalizeEvent(source.event);

  if (kind === 'commits') {
    const xml = await fetchText(`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits.atom`);
    return allXmlEntries(xml).slice(0, 15).map(entry => {
      const link = xmlAttr(entry, 'link', 'href');
      const id = xmlTag(entry, 'id') || link;
      const title = xmlTag(entry, 'title') || 'Neuer Commit';
      const updated = xmlTag(entry, 'updated');
      return {
        eventKey: id ? `commit:${id}` : null,
        source: 'github',
        title: `🐙 ${title}`,
        description: `Neuer Commit in **${owner}/${repo}**`,
        url: link,
        timestamp: updated,
        fields: [{ name: 'Repository', value: `[${owner}/${repo}](https://github.com/${owner}/${repo})`, inline: true }]
      };
    }).filter(x => x.eventKey && x.url);
  }

  if (kind === 'issues' || kind === 'pulls') {
    const endpoint = kind === 'issues' ? 'issues?state=open&per_page=15' : 'pulls?state=open&per_page=15';
    const headers = { accept: 'application/vnd.github+json' };
    if (provider.token) headers.authorization = `Bearer ${provider.token}`;
    const data = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${endpoint}`, { headers });
    return data.map(item => ({
      eventKey: `${kind}:${item.id}:${item.updated_at}`,
      source: 'github',
      title: `${kind === 'issues' ? '🧩' : '🔀'} ${item.title || 'Untitled'}`,
      description: `${kind === 'issues' ? 'Issue' : 'Pull Request'} in **${owner}/${repo}**`,
      url: item.html_url,
      thumbnail: item.user?.avatar_url,
      timestamp: item.updated_at,
      fields: [
        { name: 'Nummer', value: `#${item.number}`, inline: true },
        { name: 'Autor', value: item.user?.login || '—', inline: true },
        { name: 'Status', value: item.state || 'open', inline: true }
      ]
    }));
  }

  const xml = await fetchText(`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases.atom`);
  return allXmlEntries(xml).slice(0, 15).map(entry => {
    const link = xmlAttr(entry, 'link', 'href');
    const id = xmlTag(entry, 'id') || link;
    const title = xmlTag(entry, 'title') || 'Neuer Release';
    const updated = xmlTag(entry, 'updated');
    return {
      eventKey: id ? `release:${id}` : null,
      source: 'github',
      title: `🚀 ${title}`,
      description: `Neuer GitHub-Release: **${owner}/${repo}**`,
      url: link,
      timestamp: updated,
      fields: [{ name: 'Repository', value: `[${owner}/${repo}](https://github.com/${owner}/${repo})`, inline: true }]
    };
  }).filter(x => x.eventKey && x.url);
}

export function normalizeRepository(target) {
  const raw = String(target || '').trim().replace(/\/$/, '');
  if (!raw) throw new Error('GitHub-Ziel fehlt. Nutze owner/repository oder eine GitHub-URL.');

  const url = normalizeHttpUrl(raw);
  const fromUrl = url?.hostname === 'github.com' ? url.pathname : raw;
  const cleaned = fromUrl.replace(/^\/+|\/+$/g, '').replace(/^github\.com\//i, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('GitHub-Ziel muss owner/repository sein.');

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('Ungültiges GitHub-Ziel. Beispiel: Maxihihi/Minecraft-FPS-toggle');
  }
  return { owner, repo };
}

function normalizeEvent(value) {
  const event = String(value || 'releases').toLowerCase();
  if (event === 'release') return 'releases';
  if (event === 'pulls' || event === 'pull_requests') return 'pulls';
  if (!['releases', 'commits', 'issues', 'pulls'].includes(event)) {
    throw new Error('GitHub-Event muss releases, commits, issues oder pulls sein.');
  }
  return event;
}
