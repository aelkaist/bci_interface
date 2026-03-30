const fs = require('fs');
['chefs', 'objects', 'terrain', 'soups'].forEach(name => {
  const data = JSON.parse(fs.readFileSync(`public/graphics/${name}.json`, 'utf8'));
  console.log(`\n--- ${name} ---`);
  
  if (data.frames && !Array.isArray(data.frames)) {
     const meta = data.meta.size;
     console.log(`Image Size: ${meta.w}x${meta.h}`);
     Object.keys(data.frames).slice(0, 5).forEach(k => console.log(k, data.frames[k].frame));
  } else if (data.textures) {
     const meta = data.textures[0].size;
     console.log(`Image Size: ${meta.w}x${meta.h}`);
     data.textures[0].frames.slice(0, 5).forEach(f => console.log(f.filename, f.frame));
  }
});
