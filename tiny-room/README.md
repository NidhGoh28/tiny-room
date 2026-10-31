# Tiny Room

<p align="center"><img src="docs/night.png" width="380" alt="Tiny Room at night"> <img src="docs/day.png" width="380" alt="Tiny Room during the day"></p>

A tiny isometric pixel bedroom that floats on your desktop. Every object in it is quietly showing you something real about your Mac.

| Object | Shows | What changes |
|---|---|---|
| Window | the real sky where you are | sunrise, daylight with drifting clouds, a golden sunset, then stars and the moon. Sunlight falls on the floor during the day |
| Desk lamp | battery | a brighter, wider glow when charged; it flickers below 20%; a cable runs to the wall socket while charging |
| Fern | CPU | stands tall when your Mac is calm, droops as it gets busy, and turns yellow when it's working really hard |
| Laptop | CPU | its screen scrolls faster the busier your Mac is |
| Bookshelf | disk space | fills with books as your disk fills; past 92% books pile on top and spill onto the floor |
| Paper pile | Downloads folder | grows with the number of items; spills over at 150+; sparkles when empty |
| Mochi the cat | whether you're at your Mac | awake while you type, dozing after 1 minute away, curled up asleep after 5. She hops when you come back |
| Calendar | today, plus time since your last restart | |
| Fairy lights | | switch on at dusk and twinkle all night |

- **Hover** over anything to see what it is. **Click** it for the real numbers (CPU has a 3-minute graph). Buttons can open Downloads or Storage settings.
- **Click Mochi** for hearts.
- **Drag** the room anywhere and it stays there.
- **Right-click** for **Keep above windows**, **Size** (Small, Medium or Large), **Open at login** and **Quit**. Tiny Room doesn't use a Dock icon, so this is how you quit it.
- The first time it runs, macOS asks whether Tiny Room can see your **Downloads** folder. Click **Allow** so the paper pile works.

## Build (low on disk space? this needs about 600 MB while building)

```bash
cd ~/Downloads/tiny-room
npx -y @electron/packager@18.4.4 . "Tiny Room" --platform=darwin --electron-version=33.4.11 --icon=build/icon.icns --out=dist --overwrite --app-bundle-id=io.github.nidhgoh28.tinyroom --app-version=1.0.0 '--ignore=^/dist' '--ignore=^/build' '--ignore=^/node_modules'
open dist/
```

Drag **Tiny Room.app** into Applications, then free the space again:

```bash
rm -rf ~/Downloads/tiny-room/dist ~/Library/Caches/electron
npm cache clean --force
```

If you have room for the full toolchain (about 400 MB), `npm install`, then `npm start` to try it and `npm run mac` to build.

## Files

| File | What it is |
|---|---|
| `main.js` | Reads CPU (from `os.cpus()`), free disk space, your Downloads folder (top level only: names, sizes and dates), idle time and uptime every 2 seconds. Also handles the window, dragging and the right-click menu |
| `preload.js` | The only bridge to the page: receive stats, open Downloads or Storage or Privacy settings, show the menu, drag |
| `app/room.js` | The pixel engine and the room. It uses isometric projection, polygon fill with an id per object (for hover and outlines), wallpaper and floor shaders, a real sunrise and sunset calculation, and lighting (day and night tint, lamp glow, sunbeam, fairy lights) |
| `app/room.css` | The clock pill, tooltip and info cards |

**Privacy and security:**
- Nothing ever leaves your Mac. There's no network access at all.
- Tiny Room only reads file names, sizes and dates in Downloads, never what's inside the files.
- The page is sandboxed: navigation, pop-ups and permissions are all blocked, and the page can only open the three places listed above.
