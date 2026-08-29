namespace ClientState {
    export class Tiled implements State {
        public readonly window: Window;
        private readonly defaultState: Tiled.WindowState;
        private readonly signalManager: SignalManager;
        private static readonly maxExternalFrameGeometryChangedIntervalMs = 1000;

        constructor(world: World, client: ClientWrapper, grid: Grid) {
            this.defaultState = { skipSwitcher: client.kwinClient.skipSwitcher };
            Tiled.prepareClientForTiling(client, grid.config);

            const column = new Column(grid, grid.getLastFocusedColumn() ?? grid.getLastColumn());
            const window = new Window(client, column);

            this.window = window;
            // Announce ownership as soon as the window is tiled, not only when it later changes
            // grid. Otherwise the effect is left to guess from geometry, which is only right while
            // the window happens to sit inside its own screen.
            Tiled.setClipOwner(window, grid.desktop.getScreen().name);
            this.signalManager = Tiled.initSignalManager(world, window, grid.config);
        }

        public destroy(passFocus: FocusPassing.Type) {
            this.signalManager.destroy();

            const window = this.window;
            const grid = window.column.grid;
            const client = window.client;
            window.destroy(passFocus);

            Tiled.restoreClientAfterTiling(client, grid.config, this.defaultState, grid.desktop.clientArea);
        }

        private static initSignalManager(world: World, window: Window, config: LayoutConfig) {
            const client = window.client;
            const kwinClient = client.kwinClient;
            const manager = new SignalManager();

            manager.connect(kwinClient.desktopsChanged, () => {
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(kwinClient);
                    if (desktop === undefined) {
                        // windows on multiple desktops are not supported
                        clientManager.floatClient(client);
                        return;
                    }
                    Tiled.moveWindowToGrid(window, desktop.grid);
                });
            });

            manager.connect(kwinClient.activitiesChanged, () => {
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(kwinClient);
                    if (desktop === undefined) {
                        // windows on multiple activities are not supported
                        clientManager.floatClient(client);
                        return;
                    }
                    Tiled.moveWindowToGrid(window, desktop.grid);
                });
            });

            manager.connect(kwinClient.outputChanged, () => {
                if (kwinClient.move || client.isManipulatingGeometry(null)) {
                    // the window is still being dragged (handled in `interactiveMoveResizeFinished`),
                    // or Karousel is placing it right now
                    return;
                }
                if (client.isAtLastPlacement()) {
                    // The window is exactly where Karousel put it, so KWin re-attributing it to
                    // another output is a consequence of our own scrolling, not of a user action.
                    // With side-by-side screens this is the normal case for a column scrolled off
                    // an edge: the space past that edge *is* the neighbouring output. Following it
                    // there would hand the column to the neighbour's grid.
                    return;
                }
                const gridScreen = window.column.grid.desktop.getScreen();
                if (kwinClient.output.name === gridScreen.name) {
                    return;
                }
                world.do((clientManager, desktopManager) => {
                    Tiled.followClientToScreen(clientManager, desktopManager, client, window, null);
                });
            });

            manager.connect(kwinClient.minimizedChanged, () => {
                console.assert(kwinClient.minimized);
                world.do((clientManager, desktopManager) => {
                    clientManager.minimizeClient(kwinClient);
                });
            });

            manager.connect(kwinClient.maximizedAboutToChange, (maximizedMode: MaximizedMode) => {
                world.do(() => {
                    window.onMaximizedChanged(maximizedMode);
                });
            });

            let moving = false;
            let resizing = false;
            let resizeStartWidth = 0;
            let resizeNeighbor: { column: Column, startWidth: number } | undefined;
            manager.connect(kwinClient.interactiveMoveResizeStarted, () => {
                if (kwinClient.move) {
                    if (config.untileOnDrag) {
                        world.do((clientManager, desktopManager) => {
                            clientManager.floatClient(client);
                        });
                    } else {
                        moving = true;
                    }
                    return;
                }

                if (kwinClient.resize) {
                    resizing = true;
                    resizeStartWidth = window.column.getWidth();
                    if (config.resizeNeighborColumn) {
                        const resizeNeighborColumn = Tiled.getResizeNeighborColumn(window);
                        if (resizeNeighborColumn !== null) {
                            resizeNeighbor = {
                                column: resizeNeighborColumn,
                                startWidth: resizeNeighborColumn.getWidth(),
                            };
                        }
                    }
                    window.column.grid.onUserResizeStarted();
                }
            });

            manager.connect(kwinClient.interactiveMoveResizeFinished, () => {
                if (moving) {
                    moving = false;
                    world.do((clientManager, desktopManager) => {
                        // the user may have dragged the window onto another screen
                        Tiled.followClientToScreen(clientManager, desktopManager, client, window, roundQtRect(kwinClient.frameGeometry));
                        window.column.grid.desktop.onLayoutChanged(); // move the dragged window back to its position
                    });
                }
                if (resizing) {
                    resizing = false;
                    resizeNeighbor = undefined;
                    window.column.grid.onUserResizeFinished();
                }
            });

            const externalFrameGeometryChangedRateLimiter = new RateLimiter(4, Tiled.maxExternalFrameGeometryChangedIntervalMs);
            manager.connect(kwinClient.frameGeometryChanged, (oldGeometry: QmlRect) => {
                // on Wayland, this fires after `tileChanged`
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                    return;
                }

                const newGeometry = roundQtRect(client.kwinClient.frameGeometry);
                if (rectEquals(oldGeometry, newGeometry)) {
                    // no real changes, nothing to do
                    return;
                }

                const oldCenterX = oldGeometry.x + oldGeometry.width/2;
                const oldCenterY = oldGeometry.y + oldGeometry.height/2;
                const newCenterX = newGeometry.x + newGeometry.width/2;
                const newCenterY = newGeometry.y + newGeometry.height/2;
                const dx = Math.round(newCenterX - oldCenterX);
                const dy = Math.round(newCenterY - oldCenterY);
                if (dx !== 0 || dy !== 0) {
                    // TODO: instead of passing dx and dy, remember relative (to the parent) x and y for each
                    // transient window and use them for `moveTransients` and `ensureTransientsVisible`
                    client.moveTransients(dx, dy);
                }

                if (kwinClient.resize) {
                    world.do(() => {
                        if (newGeometry.width !== oldGeometry.width) {
                            window.column.onUserResizeWidth(
                                resizeStartWidth,
                                newGeometry.width - resizeStartWidth,
                                newGeometry.x !== oldGeometry.x,
                                resizeNeighbor,
                            );
                        }
                        if (newGeometry.height !== oldGeometry.height) {
                            window.column.adjustWindowHeight(
                                window,
                                newGeometry.height - oldGeometry.height,
                                newGeometry.y !== oldGeometry.y,
                            );
                        }
                    });
                } else if (
                    !window.column.grid.isUserResizing() &&
                    !client.isManipulatingGeometry(newGeometry) &&
                    client.getMaximizedMode() === MaximizedMode.Unmaximized &&
                    !Clients.isFullScreenGeometry(kwinClient) // not using `kwinClient.fullScreen` because it may not be set yet at this point
                ) {
                    if (
                        !kwinClient.move && // dragging is handled in `interactiveMoveResizeFinished`
                        // cheapest test first: this fires on every geometry change
                        !Tiled.isOnScreen(newGeometry, window.column.grid.desktop.getScreen()) &&
                        !client.isAtLastPlacement()
                    ) {
                        // The window was moved onto another screen, e.g. with KWin's own
                        // "Window to Next Screen" shortcut. KWin only updates `kwinClient.output`
                        // once the geometry has settled, so the new screen is derived from the new
                        // geometry instead. Without this the window would just get snapped back
                        // into the grid of its old screen.
                        kdbg("extGeom FOLLOW " + kdbgWin(kwinClient) + " new=" + kdbgRect(newGeometry));
                        world.do((clientManager, desktopManager) => {
                            Tiled.followClientToScreen(clientManager, desktopManager, client, window, newGeometry);
                        });
                        return;
                    }
                    if (externalFrameGeometryChangedRateLimiter.acquire()) {
                        world.do(() => window.onFrameGeometryChanged());
                    } else {
                        kdbg("extGeom RATE-DROPPED " + kdbgWin(kwinClient) + " new=" + kdbgRect(newGeometry));
                    }
                } else if (!client.isManipulatingGeometry(newGeometry)) {
                    // not karousel's own write, yet the external-change handling was gated off
                    kdbg("extGeom GATED " + kdbgWin(kwinClient) + " new=" + kdbgRect(newGeometry) +
                        " userResizing=" + window.column.grid.isUserResizing() +
                        " maxMode=" + client.getMaximizedMode() +
                        " fullScreenGeo=" + Clients.isFullScreenGeometry(kwinClient));
                }
            });

            manager.connect(kwinClient.fullScreenChanged, () => {
                world.do((clientManager, desktopManager) => {
                    // some clients only turn out to be untileable after exiting full-screen mode
                    if (!Clients.canTileEver(kwinClient)) {
                        clientManager.floatClient(client);
                        return;
                    }

                    window.onFullScreenChanged(kwinClient.fullScreen);
                });
            });

            manager.connect(kwinClient.tileChanged, () => {
                // on X11, this fires after `frameGeometryChanged`
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                }
            });

            return manager;
        }

        private static getResizeNeighborColumn(window: Window) {
            const eps = 20; // Detect edge near the edge as well
            const kwinClient = window.client.kwinClient;
            const column = window.column;
            if (Workspace.cursorPos.x > rectRightRound(kwinClient.clientGeometry) - eps) {
                return column.grid.getRightColumn(column);
            } else if (Workspace.cursorPos.x < kwinClient.clientGeometry.x.round() + eps) {
                return column.grid.getLeftColumn(column);
            } else {
                return null;
            }
        }

        // True if `screen` shows more than half of `frame`, in which case it is also the screen
        // showing the biggest part of it. Deliberately conservative: a window straddling several
        // screens counts as being on none of them, which only costs a redundant lookup.
        private static isOnScreen(frame: QmlRect, screen: Output) {
            return 2 * rectIntersectionArea(frame, screen.geometry) > frame.width * frame.height;
        }

        // Moves the window into the grid of the screen it currently is on. If `frame` is given, the
        // screen is the one showing the biggest part of it, otherwise the client's own idea of its
        // output is used. Passing the frame explicitly matters because KWin's `frameGeometry`
        // getter can still report the previous geometry right after a window has been moved.
        private static followClientToScreen(
            clientManager: ClientManager,
            desktopManager: DesktopManager,
            client: ClientWrapper,
            window: Window,
            frame: QmlRect|null,
        ) {
            const screen = frame === null ?
                desktopManager.getScreenForClient(client.kwinClient) :
                desktopManager.getScreenForGeometry(frame);
            if (screen === null) {
                // the window is outside of every screen, e.g. a column scrolled out of view, so
                // there is no screen for it to follow
                return;
            }
            if (screen.name === window.column.grid.desktop.getScreen().name) {
                return; // already on the right screen
            }
            const desktop = desktopManager.getDesktopForClient(client.kwinClient, screen);
            if (desktop === undefined) {
                clientManager.floatClient(client);
                return;
            }
            Tiled.moveWindowToGrid(window, desktop.grid);
        }

        private static moveWindowToGrid(window: Window, grid: Grid) {
            if (grid === window.column.grid) {
                // window already on the given grid
                return;
            }

            Tiled.setClipOwner(window, grid.desktop.getScreen().name);

            const newColumn = new Column(grid, grid.getLastFocusedColumn() ?? grid.getLastColumn());
            const passFocus = window.isFocused() ? FocusPassing.Type.OnUnfocus : FocusPassing.Type.None;
            window.moveToColumn(newColumn, true, passFocus);
        }

        // The clip2output effect keeps ownership deliberately sticky, so that scrolled-off columns
        // stay clipped to their own screen. A genuine change of screen therefore has to be
        // announced. A no-op when the effect is not loaded.
        private static setClipOwner(window: Window, screenName: string) {
            announceClipOwner(window.client.kwinClient, screenName);
        }

        private static prepareClientForTiling(client: ClientWrapper, config: LayoutConfig) {
            if (config.skipSwitcher) {
                client.kwinClient.skipSwitcher = true;
            }

            if (client.kwinClient.fullScreen) {
                if (config.maximizedKeepAbove) {
                    client.kwinClient.keepAbove = true;
                }
            } else {
                if (config.tiledKeepBelow) {
                    client.kwinClient.keepBelow = true;
                }
                client.kwinClient.keepAbove = false;
            }

            if (client.kwinClient.tile !== null) {
                client.setMaximize(false, true); // disable quick tile mode
            }
            client.setMaximize(false, false);
        }

        private static restoreClientAfterTiling(client: ClientWrapper, config: LayoutConfig, defaultState: Tiled.WindowState, screenSize: QmlRect) {
            if (config.skipSwitcher) {
                client.kwinClient.skipSwitcher = defaultState.skipSwitcher;
            }
            if (config.tiledKeepBelow) {
                client.kwinClient.keepBelow = false;
            }
            if (config.offScreenOpacity < 1.0) {
                client.kwinClient.opacity = 1.0;
            }
            client.setFullScreen(false);
            if (client.kwinClient.tile === null) {
                client.setMaximize(false, false);
            }
            client.ensureVisible(screenSize);
        }
    }

    namespace Tiled {
        export interface WindowState {
            skipSwitcher: boolean;
        }
    }
}
