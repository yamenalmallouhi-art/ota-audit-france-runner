import test from 'node:test'; import assert from 'node:assert/strict';
test('runner module loads without external API',async()=>{const m=await import('../src/audit.js');assert.equal(typeof m.auditHotel,'function')});
