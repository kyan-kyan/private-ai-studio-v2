import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNotebook} from '../notebook.js';
import {execFileSync} from 'node:child_process';
const job = {provider:'kaggle-svd',imageBase64:'aGVsbG8=',duration:2,seed:42,motion:127};
test('export is valid notebook and every Python cell compiles', () => {
  const notebook = JSON.parse(JSON.stringify(makeNotebook(job)));
  assert.equal(notebook.nbformat,4);
  assert.equal(notebook.cells.length,4);
  for (const c of notebook.cells.filter(c=>c.cell_type==='code')) {
    execFileSync('python',['-c','import sys; compile(sys.stdin.read(), "cell", "exec")'],{input:c.source.join('')});
  }
});
test('embedded image roundtrips exactly without filesystem dependencies', () => {
  const source = makeNotebook(job).cells[2].source.join('');
  const output = execFileSync('python',['-c','import sys,ast,json,base64\ntree=ast.parse(sys.stdin.read())\nnode=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="CONFIG" for t in n.targets))\nconfig=json.loads(ast.literal_eval(node.value.args[0]))\nassert base64.b64decode(config["image_base64"],validate=True)==b"hello"\nprint(config["fps"])'],{input:source,encoding:'utf8'});
  assert.equal(output.trim(),'7');
});
test('invalid jobs cannot silently generate an invalid notebook', () => {
  for (const patch of [{imageBase64:null},{imageBase64:'x\";evil()'},{duration:10},{seed:-1},{seed:1.5},{motion:256},{provider:'unknown'}]) assert.throws(()=>makeNotebook({...job,...patch}));
});
test('duration controls playback fps, inference conditioning remains fixed', () => {
  for (const [duration,fps] of [[2,7],[3,5],[4,4]]) {
    const notebook = makeNotebook({...job,duration});
    assert.ok(notebook.cells[2].source.join('').includes(`\\"fps\\":${fps}`));
    assert.ok(notebook.cells[3].source.join('').includes('fps=7'));
  }
});
