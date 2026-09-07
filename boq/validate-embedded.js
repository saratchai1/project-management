const fs=require('fs');
const cp=require('child_process');
const parts=[1,2,3,4].map(i=>fs.readFileSync(`boq/embedded-snapshot-${String(i).padStart(2,'0')}.b64`,'utf8').trim());
fs.writeFileSync('boq/embedded-snapshot.b64',parts.join(''));
cp.execFileSync(process.execPath,['boq/validate.js'],{stdio:'inherit'});
cp.execFileSync(process.execPath,['boq/extend-external66.js'],{stdio:'inherit'});
