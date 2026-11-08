import fs from 'node:fs';
const template=fs.readFileSync('emscripten/shell.html','utf8');
const css=fs.readFileSync('../emsdk/upstream/emscripten/src/shell.css','utf8');
fs.writeFileSync('build/install/index.html',template.replace('{{{ SHELL_CSS }}}',css).replace('{{{ SCRIPT }}}','<script async src="index.js"></script>'));
fs.cpSync('emscripten/assets','build/install/assets',{recursive:true});
