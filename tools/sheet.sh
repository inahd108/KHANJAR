#!/bin/bash
# tools/sheet.sh out.png anim1 anim2 ...   (dev helper: stacked animation contact sheets)
S="$(dirname "$1")"; OUT="$1"; shift
i=0; files=()
for a in "$@"; do
  node tools/shot.cjs "debug.html?outfit=Male_Ranger&n=8&anim=$a&cam=q&dist=9.5&h=0.9&fov=24&sp=1.25" "$S/_row$i.png" --w 1500 --h 330 --wait 300 | grep -v -E "vite|^$" | sed "s/^/$a /"
  files+=("$S/_row$i.png"); i=$((i+1))
done
node -e "
const sharp=require('sharp');const f=process.argv.slice(2);
sharp({create:{width:1500,height:330*f.length,channels:3,background:'#000'}}).composite(f.map((p,i)=>({input:p,left:0,top:i*330}))).png().toFile('$OUT');
" "${files[@]}"
