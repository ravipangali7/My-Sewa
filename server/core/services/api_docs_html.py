"""Standalone professional HTML documentation for the Fund Transfer API."""
from __future__ import annotations

import html as html_lib
import json


def _esc(value) -> str:
    return html_lib.escape('' if value is None else str(value))


def _code(text: str, lang: str = '') -> str:
    return (
        '<div class="code-wrap">'
        f'<div class="code-bar"><span>{_esc(lang or "code")}</span>'
        '<button type="button" class="copy" data-copy>Copy</button></div>'
        f'<pre><code>{_esc(text)}</code></pre>'
        '</div>'
    )


def _error_table(errors) -> str:
    rows = ''.join(
        '<tr>'
        f'<td><code>{item["http"]}</code></td>'
        f'<td><code>{_esc(item["code"])}</code></td>'
        f'<td>{_esc(item["error"])}</td>'
        f'<td>{_esc(item.get("message") or "")}</td>'
        '</tr>'
        for item in errors or []
    )
    return (
        '<table><thead><tr><th>HTTP</th><th>Code</th><th>Error</th><th>When</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
    )


def _param_table(fields: dict, headers=None) -> str:
    if not fields:
        return '<p class="empty">No JSON body. This endpoint uses the method and URL only.</p>'
    rows = ''.join(
        '<tr>'
        f'<td><code>{_esc(name)}</code></td>'
        f'<td>{"Yes" if field.get("required") else "No"}</td>'
        f'<td>{_esc(field.get("type"))}</td>'
        f'<td>{_esc(field.get("description"))}</td>'
        '</tr>'
        for name, field in fields.items()
    )
    return (
        '<table><thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
    )


def _render_endpoint(section: dict) -> str:
    method = (section.get('method') or 'POST').upper()
    method_class = 'get' if method == 'GET' else 'post'
    query = section.get('query') or []
    query_html = ''
    if query:
        rows = ''.join(
            '<tr>'
            f'<td><code>{_esc(item["name"])}</code></td>'
            f'<td>{"Yes" if item.get("required") else "No"}</td>'
            f'<td>{_esc(item.get("type"))}</td>'
            f'<td>{_esc(item.get("description"))}</td>'
            '</tr>'
            for item in query
        )
        query_html = (
            '<h3>Query parameters</h3>'
            '<table><thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>'
            f'<tbody>{rows}</tbody></table>'
        )
    request_html = ''
    if section.get('request_example'):
        request_html = _code(json.dumps(section['request_example'], indent=2), 'json')
    failed_html = ''
    if section.get('failed_response'):
        failed_html = '<h3>Failed verification</h3>' + _code(
            json.dumps(section['failed_response'], indent=2), 'json'
        )
    examples = section.get('examples') or {}
    notes = ''.join(f'<li>{_esc(item)}</li>' for item in section.get('notes') or [])
    return f"""
      <h2 id="{_esc(section['id'])}">{_esc(section['title'])}</h2>
      <div class="card endpoint">
        <span class="method {method_class}">{_esc(method)}</span>
        <span>{_esc(section['path'])}</span>
      </div>
      <p>{_esc(section.get('purpose') or '')}</p>
      <p>Full URL: <code>{_esc(section.get('url') or '')}</code></p>
      {query_html}
      <h3>Request parameters</h3>
      {_param_table(section.get('request_body') or {})}
      {request_html}
      <h3>Successful response</h3>
      <p>{_esc(section.get('success_http') or '')}</p>
      {_code(json.dumps(section.get('success_response') or {{}}, indent=2), 'json')}
      {failed_html}
      <h3>cURL</h3>
      {_code(examples.get('curl') or '', 'bash')}
      <h3>Python</h3>
      {_code(examples.get('python') or '', 'python')}
      <h3>JavaScript</h3>
      {_code(examples.get('javascript') or '', 'javascript')}
      <h3>Errors</h3>
      {_error_table(section.get('errors'))}
      <ul>{notes}</ul>
    """


def render_html_documentation(doc: dict) -> str:
    toc = ''.join(
        f'<a href="#{_esc(item["id"])}">{_esc(item["title"])}</a>'
        for item in doc['toc']
    )
    headers_rows = ''.join(
        '<tr>'
        f'<td><code>{_esc(h["name"])}</code></td>'
        f'<td>{"Yes" if h.get("required") else "No"}</td>'
        f'<td><code>{_esc(h["example"])}</code></td>'
        f'<td>{_esc(h.get("notes") or "")}</td>'
        '</tr>'
        for h in doc['headers']
    )
    param_rows = ''.join(
        '<tr>'
        f'<td><code>{_esc(name)}</code></td>'
        f'<td>{"Yes" if field.get("required") else "No"}</td>'
        f'<td>{_esc(field.get("type"))}</td>'
        f'<td>{_esc(field.get("description"))}</td>'
        '</tr>'
        for name, field in doc['request_body'].items()
    )
    error_rows = ''.join(
        '<tr>'
        f'<td><code>{item["http"]}</code></td>'
        f'<td><code>{_esc(item["code"])}</code></td>'
        f'<td>{_esc(item["error"])}</td>'
        f'<td>{_esc(item.get("message") or "")}</td>'
        '</tr>'
        for item in doc['error_responses']
    )
    status_rows = ''.join(
        f'<tr><td><code>{item["http"]}</code></td><td>{_esc(item["meaning"])}</td></tr>'
        for item in doc['http_status_codes']
    )
    flow = ''.join(
        f'<li><span class="step">{i}</span><span>{_esc(step)}</span></li>'
        for i, step in enumerate(doc['how_it_works'], start=1)
    )
    history_fields = ''.join(f'<li>{_esc(item)}</li>' for item in doc['transaction_history']['fields'])
    security = ''.join(f'<li>{_esc(item)}</li>' for item in doc['security'])
    validation = ''.join(f'<li>{_esc(item)}</li>' for item in doc['validation'])
    auth_notes = ''.join(f'<li>{_esc(item)}</li>' for item in doc['authentication']['notes'])
    bank_flow = ''.join(
        f'<li><span class="step">{i}</span><span>{_esc(step)}</span></li>'
        for i, step in enumerate(doc.get('bank_flow') or [], start=1)
    )
    bank_html = ''.join(_render_endpoint(section) for section in doc.get('api_sections') or [])

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_esc(doc['title'])}</title>
  <style>
    :root {{
      --brand: #0a7a4b;
      --brand-dark: #065f3a;
      --brand-soft: #e8f7ef;
      --accent: #20c36a;
      --ink: #0f172a;
      --muted: #5b6573;
      --line: #e2e8f0;
      --bg: #f5f7f6;
      --sidebar: #06281d;
      --code: #0f172a;
      --white: #ffffff;
      --danger: #dc2626;
    }}
    * {{ box-sizing: border-box; }}
    html {{ scroll-behavior: smooth; }}
    body {{
      margin: 0;
      font-family: Inter, Segoe UI, system-ui, sans-serif;
      color: var(--ink);
      background: var(--bg);
      line-height: 1.55;
    }}
    .layout {{
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      min-height: 100vh;
    }}
    .sidebar {{
      background: var(--sidebar);
      color: #d7efe4;
      padding: 28px 18px 40px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
    }}
    .brand {{
      font-weight: 800;
      letter-spacing: .04em;
      color: #fff;
      font-size: 18px;
      margin-bottom: 6px;
    }}
    .brand small {{
      display: block;
      font-weight: 500;
      opacity: .75;
      font-size: 12px;
      letter-spacing: .02em;
      margin-top: 4px;
    }}
    .search {{
      width: 100%;
      margin: 18px 0 16px;
      border: 0;
      border-radius: 10px;
      padding: 10px 12px;
      background: #0b3d2e;
      color: #fff;
    }}
    .sidebar a {{
      display: block;
      color: #c9e6d8;
      text-decoration: none;
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 13px;
    }}
    .sidebar a:hover, .sidebar a.active {{
      background: rgba(32,195,106,.16);
      color: #fff;
    }}
    .content {{
      padding: 36px 48px 80px;
      max-width: 980px;
    }}
    .hero {{
      background: linear-gradient(135deg, #0a7a4b 0%, #20c36a 100%);
      color: #fff;
      border-radius: 20px;
      padding: 32px;
      margin-bottom: 32px;
    }}
    .hero h1 {{ margin: 0 0 8px; font-size: 32px; }}
    .hero p {{ margin: 0; opacity: .92; }}
    .meta {{ margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }}
    .chip {{
      background: rgba(255,255,255,.16);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
    }}
    h2 {{
      font-size: 22px;
      margin: 42px 0 12px;
      padding-top: 8px;
    }}
    h3 {{ font-size: 16px; margin: 24px 0 8px; }}
    p, li {{ color: #334155; }}
    .card {{
      background: var(--white);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px 20px;
      margin: 16px 0;
    }}
    .endpoint {{
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 14px;
    }}
    .method {{
      background: var(--brand);
      color: #fff;
      font-weight: 700;
      border-radius: 8px;
      padding: 4px 10px;
      font-size: 12px;
    }}
    .method.get {{ background: #2563eb; }}
    .method.post {{ background: var(--brand); }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      margin: 12px 0 20px;
    }}
    th, td {{
      border-bottom: 1px solid var(--line);
      text-align: left;
      padding: 10px 12px;
      font-size: 13px;
      vertical-align: top;
    }}
    th {{ background: var(--brand-soft); color: var(--brand-dark); font-size: 12px; }}
    .code-wrap {{
      background: var(--code);
      color: #e2e8f0;
      border-radius: 14px;
      overflow: hidden;
      margin: 12px 0 20px;
    }}
    .code-bar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: #111827;
      font-size: 12px;
      color: #94a3b8;
    }}
    .copy {{
      background: transparent;
      color: #86efac;
      border: 1px solid #14532d;
      border-radius: 8px;
      padding: 4px 8px;
      cursor: pointer;
    }}
    pre {{ margin: 0; padding: 16px; overflow: auto; font-size: 12.5px; }}
    .steps {{ list-style: none; padding: 0; margin: 0; }}
    .steps li {{
      display: flex;
      gap: 12px;
      margin: 10px 0;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 14px;
    }}
    .step {{
      flex: 0 0 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--brand);
      color: #fff;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 700;
    }}
    .note {{
      background: var(--brand-soft);
      border-left: 4px solid var(--brand);
      padding: 12px 14px;
      border-radius: 0 12px 12px 0;
    }}
    .empty {{ color: var(--muted); font-style: italic; }}
    @media (max-width: 860px) {{
      .layout {{ grid-template-columns: 1fr; }}
      .sidebar {{ position: relative; height: auto; }}
      .content {{ padding: 20px 16px 48px; }}
      .hero h1 {{ font-size: 26px; }}
    }}
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">MySewa<small>Developer API</small></div>
      <input class="search" id="doc-search" type="search" placeholder="Search docs">
      <nav id="toc">{toc}</nav>
    </aside>
    <main class="content">
      <section class="hero">
        <h1>Developer API Documentation</h1>
        <p>Fund Transfer and HimalPay Bank APIs for authorized MySewa API users. Transactions are created by your application, not from the dashboard.</p>
        <div class="meta">
          <span class="chip">API { _esc(doc['version']) }</span>
          <span class="chip">Docs { _esc(doc['docs_version']) }</span>
          <span class="chip">{ _esc(doc['published_at']) }</span>
        </div>
      </section>

      <h2 id="introduction">1. Introduction</h2>
      <p>The Developer API moves NPR from the authenticated API user's wallet: to another MySewa wallet (Fund Transfer) or to a HimalPay bank account (Bank List, Verified Bank, Bank Transfer). MySewa authenticates the Bearer API key, validates the request, and returns a clean JSON result.</p>
      <div class="note">Users do not manually create API transactions from Developer / API. History only shows transfers your application already requested. Bank verification is not a wallet transaction.</div>

      <h2 id="how-it-works">How API Fund Transfer Works</h2>
      <ol class="steps">{flow}</ol>

      <h2 id="base-url">2. API Base URL</h2>
      <div class="card"><code>{_esc(doc['base_url'])}</code></div>

      <h2 id="authentication">3. Authentication</h2>
      <p>This endpoint accepts <strong>Bearer API keys only</strong>.</p>
      {_code(doc['authentication']['header'], 'http')}
      <ul>{auth_notes}</ul>

      <h2 id="api-key">4. API Key</h2>
      <ul>
        <li>An admin enables Fund Transfer API access on the account.</li>
        <li>The key is shown on Developer / API. Copy it and store it like a password.</li>
        <li>Regenerating the key immediately invalidates the previous key.</li>
      </ul>

      <h2 id="bank-flow">Bank API integration flow</h2>
      <p>Use these three endpoints in this order. They are independent HTTP APIs, but <code>/banktransfer/</code> requires a recent successful <code>/verifiedbank/</code> for the same bank details.</p>
      {_code('1. GET /api/v1/banklist/\n2. POST /api/v1/verifiedbank/\n3. POST /api/v1/banktransfer/', 'text')}
      <ol class="steps">{bank_flow}</ol>
      {bank_html}

      <h2 id="fund-transfer">5. Fund Transfer API</h2>
      <div class="card endpoint">
        <span class="method">{_esc(doc['method'])}</span>
        <span>{_esc(doc['path'])}</span>
      </div>
      <p>Full URL: <code>{_esc(doc['endpoint'])}</code></p>

      <h2 id="request">6. Request Parameters</h2>
      <table>
        <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>{param_rows}</tbody>
      </table>
      {_code(json.dumps(doc['request_example'], indent=2), 'json')}
      <h3>Validation</h3>
      <ul>{validation}</ul>

      <h2 id="headers">7. Headers</h2>
      <table>
        <thead><tr><th>Header</th><th>Required</th><th>Example</th><th>Notes</th></tr></thead>
        <tbody>{headers_rows}</tbody>
      </table>

      <h2 id="examples">8. Request Examples</h2>
      <h3 id="curl">9. cURL Example</h3>
      {_code(doc['examples']['curl'], 'bash')}
      <h3 id="python">10. Python Example</h3>
      {_code(doc['examples']['python'], 'python')}
      <h3 id="javascript">11. JavaScript Example</h3>
      {_code(doc['examples']['javascript'], 'javascript')}

      <h2 id="success">12. Successful Response</h2>
      <p>{_esc(doc['success_http'])} <code>transaction_id</code> is the wallet-transfer reference such as <code>MYSEWA_WT_...</code>.</p>
      {_code(json.dumps(doc['success_response'], indent=2), 'json')}

      <h2 id="errors">13. Error Responses</h2>
      <table>
        <thead><tr><th>HTTP</th><th>Code</th><th>Error</th><th>When</th></tr></thead>
        <tbody>{error_rows}</tbody>
      </table>
      {_code(json.dumps(doc['error_body'], indent=2), 'json')}

      <h2 id="status-codes">14. HTTP Status Codes</h2>
      <table>
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>{status_rows}</tbody>
      </table>

      <h2 id="idempotency">15. Duplicate / Idempotency Rules</h2>
      <p>{_esc(doc['idempotency'])}</p>

      <h2 id="history">16. API Transaction History</h2>
      <p>{_esc(doc['transaction_history']['summary'])}</p>
      <ul>{history_fields}</ul>
      <p>{_esc(doc['transaction_history']['note'])}</p>
      <p class="empty">{_esc(doc['transaction_history']['empty'])}</p>

      <h2 id="security">17. Security Guidelines</h2>
      <ul>{security}</ul>

      <h2 id="flow">18. Integration Flow</h2>
      <p>The same 10-step flow is listed in <a href="#how-it-works">How API Fund Transfer Works</a>. API transactions are never created by clicking a button in the dashboard.</p>
      <ol class="steps">{flow}</ol>
    </main>
  </div>
  <script>
    const copyButtons = document.querySelectorAll("[data-copy]");
    copyButtons.forEach((btn) => {{
      btn.addEventListener("click", async () => {{
        const code = btn.closest(".code-wrap").querySelector("code").innerText;
        try {{
          await navigator.clipboard.writeText(code);
          btn.textContent = "Copied";
          setTimeout(() => btn.textContent = "Copy", 1500);
        }} catch (e) {{
          btn.textContent = "Copy failed";
        }}
      }});
    }});
    const search = document.getElementById("doc-search");
    const links = Array.from(document.querySelectorAll("#toc a"));
    search.addEventListener("input", () => {{
      const q = search.value.trim().toLowerCase();
      links.forEach((a) => {{
        a.style.display = a.textContent.toLowerCase().includes(q) ? "" : "none";
      }});
    }});
  </script>
</body>
</html>
"""
