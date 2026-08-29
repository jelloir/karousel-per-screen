class Window {
    public column: Column;
    public readonly client: ClientWrapper;
    public height: number;
    public readonly focusedState: Window.State;
    private skipArrange: boolean;

    constructor(client: ClientWrapper, column: Column) {
        this.client = client;
        this.height = client.kwinClient.frameGeometry.height.round();

        let maximizedMode = this.client.getMaximizedMode();
        if (maximizedMode === undefined) {
            maximizedMode = MaximizedMode.Unmaximized; // defaulting to unmaximized, as this is set in Tiled.prepareClientForTiling
        }
        this.focusedState = {
            fullScreen: this.client.kwinClient.fullScreen,
            maximizedMode: maximizedMode,
        };

        this.skipArrange = this.client.kwinClient.fullScreen || maximizedMode !== MaximizedMode.Unmaximized;
        if (this.skipArrange) {
            kdbg("Window created with skipArrange=true " + kdbgWin(client.kwinClient) +
                " fullScreen=" + client.kwinClient.fullScreen + " maxMode=" + maximizedMode);
        }
        this.column = column;
        column.onWindowAdded(this, true);
    }

    public moveToColumn(targetColumn: Column, bottom: boolean, passFocus: FocusPassing.Type) {
        if (targetColumn === this.column) {
            return;
        }
        this.column.onWindowRemoved(this, passFocus);
        this.column = targetColumn;
        targetColumn.onWindowAdded(this, bottom);
    }

    public arrange(x: number, y: number, width: number, height: number) {
        if (this.skipArrange) {
            // window is maximized, fullscreen, or being manually resized, prevent fighting with the user
            kdbg("arrange SKIP skipArrange " + kdbgWin(this.client.kwinClient) +
                " wanted " + x + "," + y + " " + width + "x" + height);
            return;
        }

        let maximized = false;
        if (this.column.grid.config.reMaximize && this.isFocused()) {
            // do this here rather than in `onFocused` to ensure it happens after placement
            // (otherwise placement may not happen at all)
            if (this.focusedState.maximizedMode !== MaximizedMode.Unmaximized) {
                this.client.setMaximize(
                    this.focusedState.maximizedMode === MaximizedMode.Horizontally || this.focusedState.maximizedMode === MaximizedMode.Maximized,
                    this.focusedState.maximizedMode === MaximizedMode.Vertically || this.focusedState.maximizedMode === MaximizedMode.Maximized,
                );
                maximized = true;
            }
            if (this.focusedState.fullScreen) {
                this.client.setFullScreen(true);
                maximized = true;
            }
        }
        if (!maximized) {
            /*
                A window parked entirely outside its own screen is invisible, and on Wayland an
                invisible client may never draw the buffer that acknowledges a resize (KWin
                6.3 then also defers every later move of that window behind the unacknowledged
                configure, stranding it). So while the target is fully off-screen, only the
                POSITION is imposed and the size the client last delivered is kept - there is
                nothing to see anyway. The column's size is applied by the arrange that brings
                the window back into view: place() moves it in first at the delivered size,
                and once visible the client gets frame callbacks again and the resize lands.
            */
            const screen = this.column.grid.desktop.getScreen().geometry;
            const current = roundQtRect(this.client.kwinClient.frameGeometry);
            const sizeChanges = current.width !== width || current.height !== height;
            if (sizeChanges && rectIntersectionArea(Qt.rect(x, y, width, height), screen) === 0) {
                kdbg("arrange DEFER-RESIZE " + kdbgWin(this.client.kwinClient) +
                    " off-view at " + x + "," + y + ": keeping " + current.width + "x" + current.height +
                    " instead of " + width + "x" + height);
                this.client.place(x, y, current.width, current.height);
            } else {
                this.client.place(x, y, width, height);
            }
        }
    }

    public focus() {
        this.client.focus();
        const kwinClient = this.client.kwinClient;
        if (!this.isFocused()) {
            // in some situations focus assignment just doesn't work, let's do it later
            this.column.grid.focusPasser.request(kwinClient);
        }
    }

    public isFocused() {
        return this.client.isFocused();
    }

    public onFocused() {
        if (this.column.grid.config.reMaximize && (
            this.focusedState.maximizedMode !== MaximizedMode.Unmaximized ||
            this.focusedState.fullScreen
        )) {
            // We need to maximize/fullscreen this window, but we can't do it here.
            // We need to do it in `arrange` to ensure it happens after placement.
            this.column.grid.desktop.forceArrange();
        }
        this.column.onWindowFocused(this);
    }

    public raise() {
        this.client.raise();
    }

    public restoreToTiled() {
        if (this.isFocused()) {
            return;
        }
        this.client.setFullScreen(false);
        this.client.setMaximize(false, false);
    }

    public onMaximizedChanged(maximizedMode: MaximizedMode) {
        const maximized = maximizedMode !== MaximizedMode.Unmaximized;
        kdbg("onMaximizedChanged " + kdbgWin(this.client.kwinClient) + " mode=" + maximizedMode +
            " skipArrange " + this.skipArrange + "->" + maximized);
        this.skipArrange = maximized;
        if (this.column.grid.config.tiledKeepBelow) {
            this.client.kwinClient.keepBelow = !maximized;
        }
        if (this.column.grid.config.maximizedKeepAbove) {
            this.client.kwinClient.keepAbove = maximized;
        }
        if (this.isFocused()) {
            this.focusedState.maximizedMode = maximizedMode;
        }
        this.column.grid.desktop.onLayoutChanged();
    }

    public onFullScreenChanged(fullScreen: boolean) {
        kdbg("onFullScreenChanged " + kdbgWin(this.client.kwinClient) + " fullScreen=" + fullScreen +
            " skipArrange " + this.skipArrange + "->" + fullScreen);
        this.skipArrange = fullScreen;
        if (this.column.grid.config.tiledKeepBelow) {
            this.client.kwinClient.keepBelow = !fullScreen;
        }
        if (this.column.grid.config.maximizedKeepAbove) {
            this.client.kwinClient.keepAbove = fullScreen;
        }
        if (this.isFocused()) {
            this.focusedState.fullScreen = fullScreen;
        }
        this.column.grid.desktop.onLayoutChanged();
    }

    public onFrameGeometryChanged() {
        const newGeometry = this.client.kwinClient.frameGeometry;
        this.column.setWidth(newGeometry.width.round(), true);
        this.column.grid.desktop.onLayoutChanged();
    }

    public destroy(passFocus: FocusPassing.Type) {
        this.column.onWindowRemoved(this, passFocus);
    }
}

namespace Window {
    export interface State {
        fullScreen: boolean;
        maximizedMode: MaximizedMode;
    }
}
