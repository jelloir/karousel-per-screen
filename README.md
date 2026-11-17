# Karousel

> **This is not the official Karousel.** It is [Karousel](https://github.com/peterfajdiga/karousel) by Peter Fajdiga
> with one addition: [every screen gets its own grid](#multiple-screens).
> The change is proposed upstream in [peterfajdiga/karousel#3](https://github.com/peterfajdiga/karousel/issues/3),
> and this repository exists only until it is merged there.
> Each release here is the matching official release plus the per-screen patches, nothing more.
> It is offered as-is and is not separately maintained.

Scrollable tiling Kwin script. Works especially well with ultrawide screens.
Use with [this](https://github.com/peterfajdiga/kwin4_effect_geometry_change) for animations.

https://github.com/peterfajdiga/karousel/assets/22796326/2ab62d18-09c7-45f9-8fda-e5e36b8d7a02

A scrollable tiling window manager tiles windows, but it does not maximize their widths. Instead, it leaves the width of windows to the user's control.
Windows are automatically centered when possible. And when running out of width, windows can be scrolled through horizontally.

Similar window managers include [PaperWM](https://github.com/paperwm/PaperWM),
[Niri](https://github.com/YaLTeR/niri), and
[Cardboard](https://gitlab.com/cardboardwm/cardboard).

## Dependencies
Karousel requires the following QML modules:
- QtQuick 6.0
- org.kde.kwin 3.0
- org.kde.notification 1.0

## Limitations
- Doesn't support windows on all desktops
- Doesn't support windows on multiple activities

## Multiple screens
Every screen gets its own grid, scrolled independently. Windows join the grid of the screen they appear on, and moving a window to another screen (by dragging it, or with KWin's _Window to Next Screen_ shortcut) moves it into that screen's grid.

With screens side by side, a column scrolled past the edge of its screen would remain visible on the neighbouring screen. Install [clip2output](https://github.com/jelloir/clip2output) to clip each window at the boundary of its own screen. Without it, everything still works, but scrolled-away columns spill onto the neighbouring screen instead of disappearing at the seam.

## Installation
First install the _org.kde.notification_ QML module (_qml-module-org-kde-notifications_ package on Ubuntu).

Then download the [latest release](https://github.com/jelloir/karousel-per-screen/releases/latest) and extract it into _~/.local/share/kwin/scripts/_.

Or clone the repo and run `make install` (requires pnpm, node, and tsc).

This build installs as _Karousel_, in the same place as the official one, so it replaces it rather than sitting beside it, and keeps your settings and shortcuts.
If the official Karousel is installed, disable it in _System Settings → Window Management → KWin Scripts_, move _~/.local/share/kwin/scripts/karousel_ aside, extract this release in its place, re-enable Karousel, then log out and back in (KWin keeps running the old script until you do).
To go back, do the same with an [official release](https://github.com/peterfajdiga/karousel/releases/latest).

### clip2output (optional, recommended for side-by-side screens)
[clip2output](https://github.com/jelloir/clip2output) is a small KWin effect that stops columns scrolled off one screen from showing on the next.
It needs Wayland and KWin 6.3 or later, and it is compiled against KWin's own development headers, which must match your running KWin **exactly**, so rebuild it whenever your distribution updates Plasma.
On Debian/Ubuntu:

```
sudo apt install kwin-dev g++ cmake extra-cmake-modules pkg-config \
                 libdrm-dev libwayland-dev libepoxy-dev \
                 qt6-declarative-dev libkf6windowsystem-dev
git clone https://github.com/jelloir/clip2output.git
cd clip2output
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
./install.sh
kwriteconfig6 --file kwinrc --group Plugins --key clip2outputEnabled true
```

Then log out and back in. See the [clip2output README](https://github.com/jelloir/clip2output#readme) for other distributions and for troubleshooting.

## Key bindings
The key bindings can be configured in KDE System Settings among KWin's own keyboard shortcuts.
Here's the default ones:
| Shortcut                 | Action                                                                                                                         |
| ---                      | ---                                                                                                                            |
| Meta+Space               | Toggle floating                                                                                                                |
| Meta+A                   | Move focus left                                                                                                                |
| Meta+D                   | Move focus right (Clashes with default KDE shortcuts, may require manual remapping)                                            |
| Meta+W                   | Move focus up (Clashes with default KDE shortcuts, may require manual remapping)                                               |
| Meta+S                   | Move focus down (Clashes with default KDE shortcuts, may require manual remapping)                                             |
| (unassigned)             | Move focus to the next window in grid                                                                                          |
| (unassigned)             | Move focus to the previous window in grid                                                                                      |
| Meta+Home                | Move focus to start                                                                                                            |
| Meta+End                 | Move focus to end                                                                                                              |
| Meta+Shift+A             | Move window left (Moves window out of and into columns)                                                                        |
| Meta+Shift+D             | Move window right (Moves window out of and into columns)                                                                       |
| Meta+Shift+W             | Move window up                                                                                                                 |
| Meta+Shift+S             | Move window down                                                                                                               |
| (unassigned)             | Move window to the next position in grid                                                                                       |
| (unassigned)             | Move window to the previous position in grid                                                                                   |
| Meta+Shift+Home          | Move window to start                                                                                                           |
| Meta+Shift+End           | Move window to end                                                                                                             |
| (unassigned)             | Increase window height upwards                                                                                                 |
| (unassigned)             | Increase window height downwards                                                                                               |
| Meta+X                   | Toggle stacked layout for focused column (Only the active window visible)                                                      |
| Meta+Ctrl+Shift+A        | Move column left                                                                                                               |
| Meta+Ctrl+Shift+D        | Move column right                                                                                                              |
| Meta+Ctrl+Shift+Home     | Move column to start                                                                                                           |
| Meta+Ctrl+Shift+End      | Move column to end                                                                                                             |
| (unassigned)             | Move column to the next desktop                                                                                                |
| (unassigned)             | Move column to the previous desktop                                                                                            |
| Meta+Ctrl++              | Increase column width                                                                                                          |
| Meta+Ctrl+-              | Decrease column width                                                                                                          |
| (unassigned)             | Increase column width to maximum                                                                                               |
| (unassigned)             | Decrease column width to minimum                                                                                               |
| Meta+R                   | Cycle through preset column widths                                                                                             |
| Meta+Shift+R             | Cycle through preset column widths in reverse                                                                                  |
| Meta+Ctrl+X              | Equalize widths of visible columns                                                                                             |
| Meta+Ctrl+A              | Squeeze left column onto the screen (Clashes with default KDE shortcuts, may require manual remapping)                         |
| Meta+Ctrl+D              | Squeeze right column onto the screen                                                                                           |
| Meta+Alt+Return          | Center focused window (Scrolls so that the focused window is centered in the screen)                                           |
| Meta+Alt+A               | Scroll one column to the left                                                                                                  |
| Meta+Alt+D               | Scroll one column to the right                                                                                                 |
| Meta+Alt+PgUp            | Scroll left                                                                                                                    |
| Meta+Alt+PgDown          | Scroll right                                                                                                                   |
| Meta+Alt+Home            | Scroll to start                                                                                                                |
| Meta+Alt+End             | Scroll to end                                                                                                                  |
| Meta+Ctrl+Return         | Move Karousel grid to the current screen                                                                                       |
| (unassigned)             | Move this and all following columns to the next desktop                                                                        |
| (unassigned)             | Move this and all following columns to the previous desktop                                                                    |
| Meta+[N]                 | Move focus to column N (Clashes with default KDE shortcuts, may require manual remapping)                                      |
| Meta+Shift+[N]           | Move window to column N (Requires manual remapping according to your keyboard layout, e.g. Meta+Shift+1 -> Meta+!)             |
| Meta+Ctrl+Shift+[N]      | Move column to position N (Requires manual remapping according to your keyboard layout, e.g. Meta+Ctrl+Shift+1 -> Meta+Ctrl+!) |
| Meta+Ctrl+Shift+F[N]     | Move column to desktop N                                                                                                       |
| Meta+Ctrl+Shift+Alt+F[N] | Move this and all following columns to desktop N                                                                               |
