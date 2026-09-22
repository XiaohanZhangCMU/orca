import type { ManagerSession, ReportDraft, ReportVersion } from './contracts'
import { reportThemeCss } from './report-theme'

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function list(title: string, entries: string[]): string {
  if (entries.length === 0) {
    return ''
  }
  return `<section><h2>${title}</h2><ul>${entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></section>`
}

function renderReport(report: ReportDraft): string {
  return `<section><h2>Summary</h2><p>${escapeHtml(report.summary)}</p></section>
${
  report.tasks.length
    ? `<section><h2>Work</h2>${report.tasks
        .map(
          (task) => `<article>
<h3>${escapeHtml(task.title)} <span class="status">${escapeHtml(task.outcome)}</span></h3>
<p>${escapeHtml(task.summary)}</p>
${task.taskId ? `<p class="metadata">Task: <code>${escapeHtml(task.taskId)}</code></p>` : ''}
${task.dispatchId ? `<p class="metadata">Dispatch: <code>${escapeHtml(task.dispatchId)}</code></p>` : ''}
${task.evidence.length ? `<details><summary>Evidence</summary><ul>${task.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''}
</article>`
        )
        .join('')}</section>`
    : ''
}
${list('Decisions needed', report.decisions)}${list('Next steps', report.nextSteps)}`
}

export function renderReportHtml(session: ManagerSession, versions: ReportVersion[]): string {
  const current = versions.at(-1)
  if (!current) {
    throw new Error('Cannot render a report without a published version.')
  }
  const refresh = current.report.status !== 'completed' && current.report.status !== 'failed'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Manager report</title><style>
${reportThemeCss}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font-family:Geist,sans-serif;font-size:14px;letter-spacing:.01em;line-height:1.6}
main{max-width:960px;margin:auto;padding:32px 24px}header,section{margin-bottom:24px}header{border-bottom:1px solid var(--border);padding-bottom:16px}
h1{font-size:24px;line-height:1.3;margin:8px 0;overflow-wrap:anywhere}h2{font-size:14px;margin:0 0 8px}h3{font-size:14px;margin:0}
p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}li{white-space:pre-wrap;overflow-wrap:anywhere}ul{padding-left:24px}
article{border-top:1px solid var(--border);padding:16px 0}.metadata,.status,footer{color:var(--muted-foreground);font-size:12px}.eyebrow{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.status{display:inline-block;border:1px solid var(--border);border-radius:var(--radius);padding:0 8px;margin-left:8px;font-weight:400}code{font-family:var(--font-mono);overflow-wrap:anywhere}
details{border-top:1px solid var(--border);padding:8px 0}summary{cursor:pointer}summary:focus-visible,input:focus-visible{outline:2px solid var(--foreground);outline-offset:4px}
label{font-size:12px}input{accent-color:var(--foreground)}footer{border-top:1px solid var(--border);padding-top:16px}
@media(max-width:600px){main{padding:16px}}@media print{label{display:none}details{break-inside:avoid}}
</style></head><body><main>
<header><div class="eyebrow">Manager report</div><h1>${escapeHtml(session.objective)}</h1>
<p>Manager assessment: <strong>${escapeHtml(current.report.status)}</strong></p>
<p class="metadata">Version ${current.version} · Published <time datetime="${current.publishedAt}">${current.publishedAt}</time></p>
${refresh ? '<label><input id="refresh" type="checkbox" checked> Refresh every 15 seconds while not reading details or selecting text</label>' : ''}
</header>${renderReport(current.report)}
${
  versions.length > 1
    ? `<section><h2>Previous reports</h2>${versions
        .slice(0, -1)
        .toReversed()
        .slice(0, 10)
        .map(
          (version) =>
            `<details><summary>Version ${version.version} · ${version.publishedAt} · ${escapeHtml(version.report.status)}</summary>${renderReport(version.report)}</details>`
        )
        .join('')}</section>`
    : ''
}
<footer>This is the manager’s last published assessment, not a live process-status feed. A stale report does not mean an agent exited. Full history is retained in this run’s reports directory.</footer>
</main>${refresh ? `<script>setInterval(function(){var toggle=document.getElementById('refresh');if(toggle&&toggle.checked&&!document.querySelector('details[open]')&&!String(window.getSelection()))location.reload()},15000)</script>` : ''}</body></html>`
}
