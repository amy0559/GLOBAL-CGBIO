// Real-browser check of the hosted CRM page (GitHub-hosted Chromium): the page loads, the gate renders, a wrong code
// makes the browser do the CORS preflight + POST to the shared store and get the server's "bad_code" answer back.
// No team code is used or stored here. Writes verify/result.json.
const {chromium} = require('playwright'); const fs = require('fs'); const crypto = require('crypto');
const URL = 'https://amy0559.github.io/GLOBAL-CGBIO/crm.html';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const wanted = fs.existsSync('crm.html') ? sha(fs.readFileSync('crm.html')) : null; // the version this commit carries
const out = {url: URL, at: new Date().toISOString(), commit_sha256: wanted, steps: []};
const step = (name, ok, detail) => { out.steps.push({name, ok, detail}); console.log(ok ? 'OK ' : 'FAIL', name, detail || ''); };
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({viewport: {width: 1366, height: 900}});
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let gate = false, live = null;
  for (let i = 0; i < 24 && !gate; i++) { // GitHub Pages may still be deploying the commit that carries this check: wait until the live bytes ARE this commit's crm.html
    try {
      const resp = await page.goto(URL + '?v=' + Date.now(), {waitUntil: 'load', timeout: 60000});
      const body = await resp.body(); live = {page_bytes: body.length, page_sha256: sha(body)};
      if (wanted && live.page_sha256 !== wanted) { await page.waitForTimeout(15000); continue; }
      await page.waitForSelector('#cloud-code', {timeout: 15000}); gate = true;
    } catch (e) { await page.waitForTimeout(15000); }
  }
  Object.assign(out, live || {});
  step('live page is this commit\'s crm.html (sha256 match)', !!live && (!wanted || live.page_sha256 === wanted), live ? `${live.page_bytes} bytes · ${live.page_sha256.slice(0, 16)}…` : 'no response');
  step('page served and team-code gate rendered', gate);
  if (gate) {
    const ua = await page.evaluate(() => navigator.userAgent); out.userAgent = ua;
    // 1) in-page fetch exactly as the tool does it → the browser must pass the CORS preflight; the server answers bad_code
    const probe = await page.evaluate(async () => { const cfg = window.__CLOUD__; try { const r = await fetch(cfg.url + '/rest/v1/rpc/crm_list', {method: 'POST', headers: {apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json', Prefer: 'return=representation'}, body: JSON.stringify({p_code: 'WRONG-CODE', p_parent: 'settings'})}); return {status: r.status, body: (await r.text()).slice(0, 200), acao: r.headers.get('access-control-allow-origin')}; } catch (e) { return {error: String(e)}; } });
    step('browser fetch to the shared store passes CORS and reaches the server', probe.status === 400 && /bad_code/.test(probe.body), JSON.stringify(probe));
    // 2) the gate itself with a wrong code → the page shows the server's answer (so the whole client path runs)
    await page.fill('#cloud-code', 'WRONG-CODE'); await page.fill('#cloud-name', 'verify'); await page.click('#overview button.primary');
    await page.waitForFunction(() => /맞지 않습니다|연결하지 못했습니다/.test((document.querySelector('#cloud-msg') || {}).textContent || ''), null, {timeout: 20000}).catch(() => {});
    const msg = await page.evaluate(() => (document.querySelector('#cloud-msg') || {}).textContent || '');
    step('gate round trip: wrong code is refused by the server (not a network error)', /맞지 않습니다/.test(msg), msg);
    const shot = await page.screenshot({fullPage: false}); fs.writeFileSync('verify/gate.png', shot);
  }
  out.pageErrors = errors; step('no page errors', errors.length === 0, errors.join(' | '));
  out.ok = out.steps.every((s) => s.ok);
  fs.writeFileSync('verify/result.json', JSON.stringify(out, null, 1));
  await browser.close();
  if (!out.ok) process.exit(1);
})();
