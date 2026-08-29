class ClientWrapper {
    public readonly stateManager: ClientState.Manager;
    private readonly transients: ClientWrapper[];
    private readonly signalManager: SignalManager;
    public preferredWidth: number;
    private maximizedMode: MaximizedMode | undefined;
    private readonly manipulatingGeometry: Doer;
    private lastPlacement: QmlRect | null; // workaround for issue #19
    // the position of `lastPlacement` with the client's previously committed size: the state a
    // window legitimately sits in while the client has not yet drawn at the requested size
    private interimPlacement: QmlRect | null;

    constructor(
        public readonly kwinClient: KwinClient,
        constructInitialState: (client: ClientWrapper) => ClientState.State,
        public transientFor: ClientWrapper | null,
        private readonly rulesSignalManager: SignalManager | null,
    ) {
        this.kwinClient = kwinClient;
        this.transientFor = transientFor;
        this.transients = [];
        if (transientFor !== null) {
            transientFor.addTransient(this);
        }
        this.signalManager = ClientWrapper.initSignalManager(this);
        this.rulesSignalManager = rulesSignalManager;
        this.preferredWidth = kwinClient.frameGeometry.width.round();
        this.manipulatingGeometry = new Doer();
        this.lastPlacement = null;
        this.interimPlacement = null;
        this.stateManager = new ClientState.Manager(constructInitialState(this));
    }

    public place(x: number, y: number, width: number, height: number) {
        this.manipulatingGeometry.do(() => {
            if (this.kwinClient.resize) {
                // window is being manually resized, prevent fighting with the user
                kdbg("place SKIP resize-in-progress " + kdbgWin(this.kwinClient));
                return;
            }

            /*
                On Wayland, a placement that changes the window's SIZE only takes effect once
                the client draws a buffer of the new size - and a window parked off-screen gets
                no frame callbacks, so a well-behaved client stops drawing and never delivers
                that buffer. Worse, while that resize is pending, KWin defers plain moves of the
                same window too, so it cannot even be scrolled back into view: it is stranded
                wherever it was, invisible, until something else makes the client redraw.

                Writing the target position FIRST, with the size the client has already
                committed, sidesteps the whole trap: a same-size move applies immediately, even
                while a resize is pending. The window is therefore always at the position the
                layout wants; only its size catches up when the client next draws, which for a
                freshly scrolled-in window is at most one commit later.
            */
            const current = roundQtRect(this.kwinClient.frameGeometry);
            if (current.width !== width || current.height !== height) {
                this.interimPlacement = Qt.rect(x, y, current.width, current.height);
                kdbg("place-interim " + kdbgWin(this.kwinClient) + " -> " + x + "," + y +
                    " keeping " + current.width + "x" + current.height);
                this.kwinClient.frameGeometry = this.interimPlacement;
            } else {
                this.interimPlacement = null;
            }

            this.lastPlacement = Qt.rect(x, y, width, height);
            kdbg("place " + kdbgWin(this.kwinClient) + " -> " + x + "," + y + " " + width + "x" + height);
            this.kwinClient.frameGeometry = this.lastPlacement;
            if (this.kwinClient.frameGeometry !== this.lastPlacement) {
                // frameGeometry assignment failed. This sometimes happens on Wayland
                // when a window is off-screen, effectively making it stuck there.
                this.kwinClient.frameGeometry.x = x; // This makes it unstuck.
                this.kwinClient.frameGeometry = this.lastPlacement;
            }
            const applied = this.kwinClient.frameGeometry;
            if (Math.round(applied.x) !== x || Math.round(applied.y) !== y ||
                    Math.round(applied.width) !== width || Math.round(applied.height) !== height) {
                kdbg("place NOT-APPLIED " + kdbgWin(this.kwinClient) + " still " + kdbgRect(applied));
            }
        });
    }

    private moveTransient(dx: number, dy: number, kwinDesktops: KwinDesktop[]) {
        if (this.stateManager.getState() instanceof ClientState.Floating) {
            if (Clients.isOnOneOfVirtualDesktops(this.kwinClient, kwinDesktops)) {
                const frame = this.kwinClient.frameGeometry;
                this.kwinClient.frameGeometry = Qt.rect(
                    frame.x.round() + dx,
                    frame.y.round() + dy,
                    frame.width.round(),
                    frame.height.round(),
                );
            }

            for (const transient of this.transients) {
                transient.moveTransient(dx, dy, kwinDesktops);
            }
        }
    }

    public moveTransients(dx: number, dy: number) {
        for (const transient of this.transients) {
            transient.moveTransient(dx, dy, this.kwinClient.desktops);
        }
    }

    public focus() {
        Workspace.activeWindow = this.kwinClient;
    }

    public isFocused() {
        return Workspace.activeWindow === this.kwinClient;
    }

    public raise() {
        Workspace.raiseWindow(this.kwinClient);
    }

    public setMaximize(horizontally: boolean, vertically: boolean) {
        if (!this.kwinClient.maximizable) {
            this.maximizedMode = MaximizedMode.Unmaximized;
            return;
        }

        if (this.maximizedMode === undefined) {
            if (horizontally && vertically) {
                this.maximizedMode = MaximizedMode.Maximized;
            } else if (horizontally) {
                this.maximizedMode = MaximizedMode.Horizontally;
            } else if (vertically) {
                this.maximizedMode = MaximizedMode.Vertically;
            } else {
                this.maximizedMode = MaximizedMode.Unmaximized;
            }
        }

        this.manipulatingGeometry.do(() => {
            this.kwinClient.setMaximize(vertically, horizontally);
        });
    }

    public setFullScreen(fullScreen: boolean) {
        if (!this.kwinClient.fullScreenable) {
            return;
        }

        this.manipulatingGeometry.do(() => {
            this.kwinClient.fullScreen = fullScreen;
        });
    }

    public getMaximizedMode() {
        return this.maximizedMode;
    }

    // true if the client still sits exactly where Karousel last put it, i.e. its geometry wasn't
    // changed by the user or by KWin
    public isAtLastPlacement() {
        if (this.lastPlacement === null) {
            return false;
        }
        const frame = roundQtRect(this.kwinClient.frameGeometry);
        if (rectEquals(frame, this.lastPlacement)) {
            return true;
        }
        // right position, size not yet delivered by the client - still where Karousel put it
        return this.interimPlacement !== null && rectEquals(frame, this.interimPlacement);
    }

    public isManipulatingGeometry(newGeometry: QmlRect | null) {
        if (newGeometry !== null && (newGeometry === this.lastPlacement || newGeometry === this.interimPlacement)) {
            return true;
        }
        return this.manipulatingGeometry.isDoing();
    }

    private addTransient(transient: ClientWrapper) {
        this.transients.push(transient);
    }

    private removeTransient(transient: ClientWrapper) {
        const i = this.transients.indexOf(transient);
        this.transients.splice(i, 1);
    }

    public ensureTransientsVisible(screenSize: QmlRect) {
        for (const transient of this.transients) {
            if (transient.stateManager.getState() instanceof ClientState.Floating) {
                transient.ensureVisible(screenSize);
                transient.ensureTransientsVisible(screenSize);
            }
        }
    }

    public ensureVisible(screenSize: QmlRect) {
        if (!Clients.isOnVirtualDesktop(this.kwinClient, Workspace.currentDesktop)) {
            return;
        }
        const frame = roundQtRect(this.kwinClient.frameGeometry);
        if (frame.x < screenSize.x) {
            this.place(screenSize.x, frame.y, frame.width, frame.height);
        } else if (rectRight(frame) > rectRight(screenSize)) {
            this.place(rectRight(screenSize) - frame.width, frame.y, frame.width, frame.height);
        }
    }

    public destroy(passFocus: FocusPassing.Type) {
        this.stateManager.destroy(passFocus);
        this.signalManager.destroy();
        if (this.rulesSignalManager !== null) {
            this.rulesSignalManager.destroy();
        }
        if (this.transientFor !== null) {
            this.transientFor.removeTransient(this);
        }
        for (const transient of this.transients) {
            transient.transientFor = null;
        }
    }

    private static initSignalManager(client: ClientWrapper) {
        const manager = new SignalManager();

        manager.connect(client.kwinClient.maximizedAboutToChange, (maximizedMode: MaximizedMode) => {
            kdbg("maximizedAboutToChange " + kdbgWin(client.kwinClient) + " mode=" + maximizedMode +
                " (was " + client.maximizedMode + ") geo=" + kdbgRect(client.kwinClient.frameGeometry));
            if (maximizedMode !== MaximizedMode.Unmaximized && client.kwinClient.tile !== null) {
                client.kwinClient.tile = null;
            }
            client.maximizedMode = maximizedMode;
        });

        return manager;
    }
}
