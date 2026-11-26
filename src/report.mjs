// Turn the analysis JSON into a readable report.md.
export function reportMd({ a, gh, facts, sanitized, video, qa, videoNote }) {
  const he = /[֐-׿]/.test(a.oneLiner);
  const L = he
    ? { verdict: 'שורה תחתונה', fit: 'התאמה', what: 'מה זה עושה', uses: 'איך זה יכול לעזור לך', risks: 'סיכונים', setup: 'התקנה', work: 'בעבודה', home: 'בבית', ev: 'ראיות', video: 'סרטון', safety: 'מה הוסר מהריפו לפני הניתוח' }
    : { verdict: 'Verdict', fit: 'Fit', what: 'What it does', uses: 'How it can help you', risks: 'Risks', setup: 'Setup', work: 'At work', home: 'At home', ev: 'Evidence', video: 'Video', safety: 'Removed from the repo before analysis' };
  const lines = [
    he ? '<div dir="rtl">\n' : '',
    `# ${a.repoName}`,
    '',
    `**${a.oneLiner}** · [${gh.web.replace('https://', '')}](${gh.web})`,
    facts ? `\n${facts.stars ?? '?'}★ · ${facts.license ?? 'no license'} · ${facts.language ?? ''} · last push ${facts.pushedAt?.slice(0, 10) ?? '?'}${facts.archived ? ' · ARCHIVED' : ''}` : '',
    '',
    `## ${L.verdict}: ${a.verdict.toUpperCase()} · ${L.fit} ${a.fitScore}/10`,
    ...(a.tldr?.length ? a.tldr.map(t => `- ${t}`) : []),
    '',
    a.fitReason,
    '',
    `## ${L.what}`,
    a.whatItDoes,
    '',
    `## ${L.uses}`,
    ...(a.uses.length ? a.uses.map(u => `- **${u.title}** (${[u.who, u.context, `effort ${u.effort}`, u.data].filter(Boolean).join(', ')}): ${u.detail}`) : ['-']),
    '',
    ...(a.example ? [
      `## ${he ? 'דוגמה לשימוש' : 'Example'}: ${a.example.title}`,
      `_${he ? 'המחשה, לא הרצה בפועל' : 'Illustration, not a test run'} · ${he ? 'מבוסס על' : 'based on'} \`${a.example.basedOn}\`_`,
      '', a.example.scenario, '',
      '```', ...a.example.input.map(l => `> ${l}`), '```',
      ...a.example.steps.map(s => `1. ${s}`),
      '```', ...a.example.output, '```', '',
    ] : []),
    `## ${L.work} / ${L.home}`,
    `- **${L.work}:** ${a.worksAtWork}`,
    `- **${L.home}:** ${a.worksAtHome}`,
    '',
    `## ${L.setup}`,
    ...a.setup.requirements.map(r => `- ${r}`),
    a.setup.install ? `\n\`\`\`\n${a.setup.install}\n\`\`\`` : '',
    '',
    `## ${L.risks}`,
    ...(a.risks.length ? a.risks.map(r => `- ${r}`) : ['-']),
    '',
    `## ${L.ev}`,
    ...a.evidence.map(e => `- ${e.claim} — \`${e.file}\``),
    '',
  ];
  if (!video && videoNote) lines.push(`## ${L.video}`, `- Skipped: ${videoNote}`, '');
  if (video) {
    lines.push(`## ${L.video}`, `- [demo.mp4](demo.mp4) · ${qa ? `${qa.duration.toFixed(1)} s, ${qa.width}x${qa.height}, brightness jumps: ${qa.brightnessJumps} (worst ${qa.worstJump}/255)` : ''}`, `- Contact sheet: [demo-sheet.jpg](demo-sheet.jpg)`, `- Edit in the viewer: \`motlab edit "${video}"\``, '');
  }
  lines.push(`## ${L.safety}`, ...(sanitized.length ? sanitized.map(s => `- ${s}`) : ['- nothing']), '');
  if (he) lines.push('</div>');
  return lines.filter(l => l !== null).join('\n');
}
