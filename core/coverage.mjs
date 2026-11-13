// 観点カバレッジ（--build-only で生成。ブラウザ不要）：設計書の項目にケースがあるか、期待値に設計書の根拠があるかを機械的に確認する。
// 設計書（Markdown）から拾う項目
//   画面      見出し行に「画面」を含む表（画面一覧）で、先頭セルが画面 ID（例 S01）の行。ケースの screen に ID が出てくれば対応あり
//   メッセージ 「…。」で括られた文言、表のセルのうち「。」で終わる文言、見出しに「メッセージ」「message」を含む列のセル（英語の画面など）。ケースの期待値（verify・check・aiWaitFor）に出てくれば対応あり
//             「残り N 枚」のような可変部（半角英大文字 1 文字、{…}）は任意の文字列として照合する
//   要件 ID   site.coverage.idPattern（例 /REQ-\d+/g）を指定した場合。ケースの refs に書いてあれば対応あり
// 逆方向：ケースの期待値のうち「。」で終わる文言が設計書にない場合、「設計書に根拠のない期待値」として挙げる
// （画面に出ていた文言をそのまま期待値にすると、不具合を「正しい」としてしまうため）。
import fs from 'fs';
import { rel } from './paths.mjs';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 可変部を含む文言 → 照合用の正規表現
const pattern = text => new RegExp(esc(text).replace(/\\\{[^}]*\\\}|(?<![A-Za-z0-9])[A-Z](?![A-Za-z0-9])/g, '.+?'));

export function designItems(md, { idPattern, screenId = /^[A-Z]{1,3}\d{2,}$/ } = {}) {
  const items = []; const seen = new Set();
  const add = (type, key, text) => { if (!seen.has(type + key)) { seen.add(type + key); items.push({ type, key, text }); } };
  let header = null; // いま読んでいる表の見出し行（表の外では null）
  for (const line of md.split('\n')) {
    const cells = line.trim().startsWith('|') ? line.trim().split('|').slice(1, -1).map(c => c.trim().replace(/^`|`$/g, '')) : null;
    if (!cells) header = null; else header ??= cells;
    // 画面 ID の形をした先頭セルは、商品コードなど別の表にも現れるため、画面一覧の表だけを対象にする
    if (cells && header.some(c => c.includes('画面')) && screenId.test(cells[0]) && cells[1]) add('画面', cells[0], cells[1]);
    // 「メッセージ」列：句点で終わらない文言（英語など）もメッセージとして拾う
    const mi = header?.findIndex(c => /メッセージ|message/i.test(c)) ?? -1;
    if (cells && cells !== header && mi >= 0 && cells[mi] && !/^-+$/.test(cells[mi]) && cells[mi].length <= 120) add('メッセージ', cells[mi], cells[mi]);
    for (const m of line.matchAll(/「([^「」]+。)」/g)) add('メッセージ', m[1], m[1]);
    for (const c of cells ?? []) if (/。$/.test(c) && !/[「」|]/.test(c) && c.length <= 80) add('メッセージ', c, c);
    if (idPattern) for (const m of line.matchAll(idPattern)) add('要件', m[0], line.replace(/^[\s|\-*#]+/, '').slice(0, 60));
  }
  return items;
}

// ケースの期待値として使われている文字列（verify のリテラル・check 関数のソース・aiWaitFor の指示文）
function expectedTexts(c) {
  const out = [];
  const walk = v => { if (typeof v === 'string') out.push(v); else if (v instanceof RegExp) out.push(v.source); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const v of c.verify ?? []) { walk(v[2]); if (v[2]?.label) out.push(v[2].label); }
  if (c.check) for (const m of c.check.toString().matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3]);
  for (const st of c.flow) if (st.aiWaitFor) out.push(st.aiWaitFor);
  return out;
}

export function analyze(md, SUITES, opt = {}) {
  const cases = SUITES.flatMap(s => s.cases);
  const texts = new Map(cases.map(c => [c.id, expectedTexts(c)]));
  const rows = designItems(md, opt).map(it => {
    const re = it.type === 'メッセージ' ? pattern(it.text) : null;
    const by = cases.filter(c => it.type === '画面' ? c.screen.includes(it.key) : it.type === '要件' ? (c.refs ?? []).includes(it.key) : texts.get(c.id).some(t => re.test(t))).map(c => c.id);
    return { ...it, cases: by };
  });
  // 逆方向：メッセージらしい期待値（「。」で終わる）が設計書にあるか
  const messages = rows.filter(r => r.type === 'メッセージ').map(r => pattern(r.text));
  const unfounded = [];
  for (const c of cases) for (const t of new Set(texts.get(c.id).flatMap(t => [...t.matchAll(/「([^「」]+。)」/g)].map(m => m[1]).concat(/。$/.test(t) && !/[「」]/.test(t) ? [t] : []))))
    if (!md.includes(t) && !messages.some(re => re.test(t))) unfounded.push({ id: c.id, text: t });
  return { rows, unfounded };
}

export function writeCoverage(file, site, SUITES) {
  const md = [].concat(site.design).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const { rows, unfounded } = analyze(md, SUITES, site.coverage);
  const uncovered = rows.filter(r => !r.cases.length);
  const cases = SUITES.flatMap(s => s.cases);
  const kinds = [...new Set(cases.map(c => c.kind))];
  const screens = [...new Set(cases.map(c => c.screen))];
  const L = ['# 観点カバレッジ（自動生成）', '',
    `設計書：${[].concat(site.design).map(rel).join('、')}　ケース：${cases.length} 件`, '',
    `- 設計書から拾った項目 **${rows.length}**、ケースあり **${rows.length - uncovered.length}**、未対応 **${uncovered.length}**`,
    `- 設計書に根拠のない期待値 **${unfounded.length}** 件`, '',
    '> 機械的に拾えるのは画面・メッセージ（・要件 ID）だけ。業務ルールや境界値の網羅は、この表ではなく観点表のレビューで確認する。', ''];
  if (uncovered.length) L.push('## 未対応の項目（ケースを追加するか、対象外の理由を残す）', '', ...uncovered.map(r => `- ${r.type}：${r.text}${r.type === '画面' ? `（${r.key}）` : ''}`), '');
  if (unfounded.length) L.push('## 設計書に根拠のない期待値（設計書を確認する。画面の表示を写した期待値は不具合を見逃す）', '', ...unfounded.map(u => `- ${u.id}：「${u.text}」`), '');
  L.push('## 設計書の項目とケース', '', '| 種別 | 設計書の項目 | ケース |', '|---|---|---|',
    ...rows.map(r => `| ${r.type} | ${r.type === '画面' ? `${r.key} ${r.text}` : r.text.replace(/\|/g, '｜')} | ${r.cases.join(', ') || '**なし**'} |`), '',
    '## 画面×区分のケース数', '', `| 画面 | ${kinds.join(' | ')} | 計 |`, `|---|${kinds.map(() => '---').join('|')}|---|`,
    ...screens.map(sc => `| ${sc} | ${kinds.map(k => cases.filter(c => c.screen === sc && c.kind === k).length || '').join(' | ')} | ${cases.filter(c => c.screen === sc).length} |`), '');
  fs.writeFileSync(file, L.join('\n'));
  return { total: rows.length, covered: rows.length - uncovered.length, uncovered: uncovered.map(r => r.type === '画面' ? `${r.key} ${r.text}` : r.text), unfounded };
}
