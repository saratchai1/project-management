const fs=require('fs');
const parts=[1,2,3,4].map(i=>fs.readFileSync(`boq/embedded-snapshot-${String(i).padStart(2,'0')}.b64`,'utf8').trim());
fs.writeFileSync('boq/embedded-snapshot.b64',parts.join(''));
require('./validate.js');
