import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');

// Source contracts only: these do not run a layout engine, accessibility tree,
// keyboard, screen reader, native dialog, touch target or actual browser.
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/g)].map(([,name,value])=>[name,value]));
}
function element(id) {
  const found=html.match(new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\bid="${id}"[^>]*>`,'i'));
  assert.ok(found,`Expected element #${id}`);return {tag:found[0],name:found[1],attrs:attributes(found[0])};
}
function declaration(selector) {
  const result={};
  for(const [,selectors,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if(!selectors.split(',').map(x=>x.trim()).includes(selector))continue;
    for(const part of body.split(';')) {
      const colon=part.indexOf(':');if(colon<0)continue;
      result[part.slice(0,colon).trim()]=part.slice(colon+1).trim();
    }
  }
  return result;
}
function color(value) {
  const roots=declaration(':root');
  value=value.replace(/var\((--[a-z-]+)\)/g,(_,key)=>roots[key]);
  assert.match(value,/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i,`Expected solid source color, got ${value}`);
  if(value.length===4)value='#'+[...value.slice(1)].map(x=>x+x).join('');
  return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255);
}
function luminance(value) {
  const linear=color(value).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  return linear.reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
}
function contrast(a,b) {const values=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (values[1]+.05)/(values[0]+.05);}

test('every dialog references a heading element for its accessible name',()=>{
  const dialogs=[...html.matchAll(/<dialog\b[^>]*>/g)];assert.equal(dialogs.length,3);
  for(const [tag] of dialogs) {
    const attrs=attributes(tag);assert.ok(attrs['aria-labelledby'],`${attrs.id} has no labelledby`);
    for(const id of attrs['aria-labelledby'].split(/\s+/)) {
      const heading=element(id);assert.match(heading.name,/^h[1-6]$/);
      assert.doesNotMatch(heading.tag,/\bhidden(?:\s|>|=)/,`${id} must not be explicitly hidden`);
    }
  }
});
test('the confirmation dialog references its explanatory text',()=>{
  assert.equal(element('confirm-dialog').attrs['aria-describedby'],'confirm-text');assert.equal(element('confirm-text').name,'p');
});
test('the import input is named and has visible adjacent-label focus styling',()=>{
  const input=element('file-input');assert.equal(input.attrs.type,'file');assert.notEqual(input.attrs.tabindex,'-1');
  assert.match(html,/<input\b[^>]*id="file-input"[^>]*>\s*<label\b[^>]*for="file-input"[^>]*>/);
  const focus=declaration('#file-input:focus-visible + .upload-button');
  assert.ok(focus.outline && !/^(?:none|0)$/.test(focus.outline),'Import label needs a visible outline rule');
});
test('the practice filter exposes its initial selected state',()=>{
  assert.equal(element('all-cards').attrs['aria-pressed'],'true');assert.equal(element('review-cards').attrs['aria-pressed'],'false');
});

for(const [label,foreground,background] of [
  ['secondary text on paper','.input-meta','.panel'],
  ['footer text','.footer','body'],
  ['placeholder text','input::placeholder','input'],
  ['text buttons on paper','.text-button','.panel'],
  ['pills','.pill','.pill'],
  ['source links','.source-link','.source-link'],
  ['optional answer label','.optional','.panel']
])test(`declared ${label} colors meet 4.5:1 normal-text contrast`,()=>{
  const fg=declaration(foreground).color,bg=declaration(background).background;
  assert.ok(fg,`${foreground} color missing`);assert.ok(bg,`${background} background missing`);
  const ratio=contrast(fg,bg);assert.ok(ratio>=4.5,`${label}: ${ratio.toFixed(3)}:1 from ${fg} on ${bg}`);
});
