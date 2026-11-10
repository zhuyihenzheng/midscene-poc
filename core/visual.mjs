// 見た目の比較（--visual）：証跡の画面を基準の画像と画素単位で比べ、違いを「注意」として結果に載せる。
// DOM の値では拾えない崩れ（レイアウト・色・重なり・文字の欠け）を、AI の目視なしで見つけるためのもの。
//   基準は <tests>/visual-baseline/*.png。初回は自動で登録し、意図した変更は --update-visual で取り込む。
//   画像は OS・ブラウザ・フォントで変わるため、基準は実行する端末ごとに持つ（*.png は .gitignore 済みでリポジトリには入らない）。
//   site.visual = { threshold: 0.001（違う画素の割合の許容値）, mask: ['#clock', '.ad']（比較から外す要素のセレクター） }
import fs from 'fs'; import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export function compareVisual(shots, { baselineDir, diffDir, threshold = 0.001, update = false }) {
  const out = [];
  fs.mkdirSync(baselineDir, { recursive: true }); fs.mkdirSync(diffDir, { recursive: true });
  for (const s of shots) {
    if (!s.png || !fs.existsSync(s.png)) continue;
    const name = path.basename(s.png); const base = path.join(baselineDir, name);
    const r = { caseId: s.caseId, label: s.label, file: name };
    if (update || !fs.existsSync(base)) { out.push({ ...r, status: fs.existsSync(base) ? 'updated' : 'new' }); fs.copyFileSync(s.png, base); continue; }
    const a = PNG.sync.read(fs.readFileSync(base)); const b = PNG.sync.read(fs.readFileSync(s.png));
    if (a.width !== b.width || a.height !== b.height) { out.push({ ...r, status: 'changed', ratio: 1, detail: `画像の大きさが違う（基準 ${a.width}×${a.height}、今回 ${b.width}×${b.height}）` }); continue; }
    const diff = new PNG({ width: a.width, height: a.height });
    const ratio = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 }) / (a.width * a.height);
    if (ratio <= threshold) { out.push({ ...r, status: 'same', ratio }); continue; }
    const diffFile = path.join(diffDir, name.replace(/\.png$/, '-diff.png'));
    fs.writeFileSync(diffFile, PNG.sync.write(diff));
    out.push({ ...r, status: 'changed', ratio, diff: diffFile, detail: `違う画素 ${(ratio * 100).toFixed(2)}%（赤が違う箇所）` });
  }
  return out;
}

// 比較結果をケースの観点（注意）に変換する
export function visualItems(list, caseId) {
  return (list ?? []).filter(v => v.caseId === caseId && v.status === 'changed').map(v => ({ desc: `見た目の比較：${v.label}`, auto: true, warn: true, visual: true, pass: true,
    expected: '基準の画面と同じ', actual: v.detail }));
}
