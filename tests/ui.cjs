const { _electron: electron } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
const dgram = require('node:dgram');

async function main() {
  fs.mkdirSync('artifacts',{recursive:true});
  const fixture=spawn(process.execPath,[path.join(__dirname,'fixture.cjs')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let application;
  try {
    const [chunk]=await once(fixture.stdout,'data'); const target=JSON.parse(chunk.toString());
    application=await electron.launch(process.env.PORTLIGHT_PACKAGED ? {executablePath:path.resolve('release/win-unpacked/Portlight.exe')} : {args:[path.resolve(__dirname,'..')]});
    const page=await application.firstWindow();
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.locator(`tr[data-id="TCP:${target.tcp}:${target.pid}"]`).waitFor({timeout:30000});
    assert.ok(Number(await page.locator('#stat-tcp').textContent())>0);
    const backend=await page.evaluate(()=>window.portlight.scan());
    const owned=backend.rows.filter(r=>r.pid===target.pid);
    assert.equal(owned.length,3,'IPv4 TCP, IPv6 TCP and UDP are detected');
    assert.ok(owned.every(r=>!r.protectedReason),'Test fixture is stoppable');
    const primary=owned.find(r=>r.port===target.tcp);
    const identityFailure=await page.evaluate(async target=>{try{await window.portlight.stop([{id:target.id,identity:'1'}]);return '';}catch(e){return e.message;}},primary);
    assert.match(identityFailure,/changed/,'Stale identities are rejected');
    const protectedRow=backend.rows.find(r=>r.protectedReason);
    if(protectedRow){const protection=await page.evaluate(async row=>{try{await window.portlight.stop([{id:row.id,identity:row.identity}]);return '';}catch(e){return e.message;}},protectedRow);assert.ok(protection,'Protected processes cannot be stopped through IPC');}
    await page.screenshot({path:'artifacts/portlight-overview.png'});
    await page.locator('#search').fill(String(target.tcp));
    assert.equal(await page.locator('#port-rows tr').count(),1,'Search filters by port');
    await page.locator('tr [data-action="pin"]').click();
    await page.locator('[data-view="favorites"]').click();
    await page.locator(`tr[data-id="${primary.id}"]`).waitFor();
    await page.locator(`tr[data-id="${primary.id}"] [data-action="pin"]`).click();
    await page.locator('[data-view="udp"]').click();
    await page.locator(`tr[data-id="UDP:${target.udp}:${target.pid}"]`).waitFor();
    await page.locator('[data-view="developer"]').click();
    await page.locator('#search').fill(String(target.tcp));
    await page.locator('tr .port-number').click();
    await page.locator('#drawer-overlay:not(.hidden)').waitFor();
    assert.match(await page.locator('#drawer-body').textContent(),new RegExp(String(target.udp)),'Details show every other port owned by the process');
    await page.locator('#detail-copy').click();
    const clipboard=await application.evaluate(({clipboard})=>clipboard.readText());
    assert.equal(clipboard,`http://127.0.0.1:${target.tcp}`);
    await page.screenshot({path:'artifacts/portlight-details.png'});
    await page.locator('#detail-stop').click();
    assert.match(await page.locator('#modal-body').textContent(),new RegExp(String(target.udp)),'Stop confirmation includes UDP ports');
    await page.locator('#modal-cancel').click();
    assert.equal(fixture.exitCode,null,'Cancel does not terminate the process');
    await page.locator('#search').fill(String(target.pid));
    for (const row of owned) await page.locator(`tr[data-id="${row.id}"] input[data-action="select"]`).check();
    assert.match(await page.locator('#stop-selected').textContent(),/\(1\)/,'Three selected ports resolve to one owning process');
    await page.locator('#stop-selected').click();
    await page.screenshot({path:'artifacts/portlight-stop.png'});
    const exited=once(fixture,'exit');
    await page.locator('#modal-confirm').click();
    await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fixture was not stopped')),20000))]);
    await page.locator('#modal-overlay').waitFor({state:'hidden',timeout:30000});
    const after=await page.evaluate(()=>window.portlight.scan());
    assert.ok(!after.rows.some(r=>r.pid===target.pid),'All ports disappear after the owning process stops');
    const server=net.createServer(); await new Promise((resolve,reject)=>server.once('error',reject).listen(target.tcp,'127.0.0.1',resolve));await new Promise(resolve=>server.close(resolve));
    const udp=dgram.createSocket('udp4');await new Promise((resolve,reject)=>{udp.once('error',reject);udp.bind(target.udp,'127.0.0.1',resolve)});udp.close();
    await page.locator('[data-view="activity"]').click();assert.match(await page.locator('#activity-list').textContent(),/stopped/);
    await page.locator('#settings').click();await page.locator('#refresh-interval').selectOption('10');await page.locator('#settings-done').click();
    await page.locator('#settings').click();await page.locator('#refresh-interval').selectOption('5');await page.locator('#settings-done').click();
    await page.locator('[data-view="tcp"]').click();
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(940,680));
    await page.screenshot({path:'artifacts/portlight-compact.png'});
    assert.equal(await page.evaluate(()=>document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth),false,'Layout fits compact windows');
    assert.deepEqual(errors,[],'Renderer has no runtime errors');
    console.log(`PASS: ${process.env.PORTLIGHT_PACKAGED?'packaged':'development'} app; live TCP + IPv6 + UDP detection, process identity, protection, search, pin, details, clipboard, cancellation, actual stop, released ports, activity and preferences.`);
  } finally {
    if(fixture.exitCode===null)fixture.kill();
    if(application)await application.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
