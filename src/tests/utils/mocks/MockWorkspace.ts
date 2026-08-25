class MockWorkspace {
    public readonly __brand = "Workspace";

    public activities = ["test-activity"];
    public desktops: KwinDesktop[] = [
        { __brand: "KwinDesktop", id: "desktop1", name: "Desktop 1" },
        { __brand: "KwinDesktop", id: "desktop2", name: "Desktop 2" },
    ];
    public currentActivity = this.activities[0];
    public screens: Output[];
    public activeScreen: Output;
    public readonly windows: MockKwinClient[] = [];
    public cursorPos = new MockQmlPoint(0, 0);

    private _currentDesktop = this.desktops[0];
    private _activeWindow: KwinClient|null = null;

    constructor(screenGeometries: MockQmlRect[] = [screen]) {
        this.screens = MockWorkspace.makeScreens(screenGeometries);
        this.activeScreen = this.screens[0];
    }

    private static makeScreens(screenGeometries: MockQmlRect[]): Output[] {
        return screenGeometries.map((geometry, index) => ({
            __brand: "Output" as const,
            name: `screen${index + 1}`,
            geometry: geometry,
        }));
    }

    public readonly currentDesktopChanged = new MockQSignal<[]>();
    public readonly windowAdded = new MockQSignal<[KwinClient]>();
    public readonly windowRemoved = new MockQSignal<[KwinClient]>();
    public readonly windowActivated = new MockQSignal<[KwinClient|null]>();
    public readonly screensChanged = new MockQSignal<[]>();
    public readonly activitiesChanged = new MockQSignal<[]>();
    public readonly desktopsChanged = new MockQSignal<[]>();
    public readonly currentActivityChanged = new MockQSignal<[]>();
    public readonly virtualScreenSizeChanged = new MockQSignal<[]>();

    public clientArea(option: ClientAreaOption, output: Output, kwinDesktop: KwinDesktop) {
        return this.getKnownOutput(output).geometry;
    }

    // Resolves an `Output` to the one this mock owns, so a stale object can't leak through.
    private getKnownOutput(output: Output|null|undefined) {
        if (output === null || output === undefined) {
            return this.activeScreen;
        }
        return this.screens.find(s => s.name === output.name) ?? this.activeScreen;
    }

    // The screen showing the biggest part of `frame`, or null if it is outside all of them,
    // e.g. a column scrolled out of view.
    public getOutputForGeometry(frame: QmlRect): Output|null {
        let bestOutput: Output|null = null;
        let bestArea = 0;
        for (const output of this.screens) {
            const area = rectIntersectionArea(frame, output.geometry);
            if (area > bestArea) {
                bestArea = area;
                bestOutput = output;
            }
        }
        return bestOutput;
    }

    // Simulates plugging or unplugging monitors. Screens keep their `screenN` name.
    public setScreens(screenGeometries: MockQmlRect[]) {
        this.screens = MockWorkspace.makeScreens(screenGeometries);
        this.activeScreen = this.screens.find(s => s.name === this.activeScreen.name) ?? this.screens[0];
        this.screensChanged.fire();
    }

    public raiseWindow(kwinClient: KwinClient) {}

    public createWindows(...kwinClients: MockKwinClient[]) {
        for (const kwinClient of kwinClients) {
            this.windows.push(kwinClient);
            this.windowAdded.fire(kwinClient);
            this.activeWindow = kwinClient;
        }
    }

    public createClients(n: number) {
        return this.createClientsWithWidths(...Array(n).fill(100));
    }

    public createClientsWithFrames(...frames: MockQmlRect[]) {
        const clients = frames.map(rect => new MockKwinClient(rect));
        clients.forEach((client, index) => client.caption = `Client ${index}`);
        this.createWindows(...clients);
        return clients;
    }

    public createClientsWithWidths(...widths: number[]) {
        return this.createClientsWithFrames(...widths.map(width => new MockQmlRect(randomInt(100), randomInt(100), width, 100+randomInt(400))));
    }

    public removeWindow(window: MockKwinClient) {
        this.activeWindow = null;
        runReorder(
            () => this.windows.splice(this.windows.indexOf(window), 1),
            () => this.windowRemoved.fire(window),
        );
        if (this.activeWindow === null) {
            activateRandomWindowOnDesktop(this.currentDesktop);
        };
    }

    public moveWindow(window: MockKwinClient, ...deltas: QmlPoint[]) {
        const frame = window.getFrameGeometryCopy();
        window.move = true;
        window.interactiveMoveResizeStarted.fire();

        for (const delta of deltas) {
            if (delta.x !== 0) {
                frame.x += delta.x;
            }
            if (delta.y !== 0) {
                frame.y += delta.y;
            }
            runOneOf(
                () => window.getActualFrameGeometry().set(frame),
                () => window.frameGeometry = frame,
            );
        }

        window.move = false;
        window.interactiveMoveResizeFinished.fire();
    }

    public resizeWindow(window: MockKwinClient, edgeResize: boolean, leftEdge: boolean, topEdge: boolean, ...deltas: QmlSize[]) {
        const frame = window.getFrameGeometryCopy();
        if (edgeResize) {
            this.cursorPos = new MockQmlPoint(
                leftEdge ? frame.x : rectRight(frame),
                topEdge ? frame.y : rectBottom(frame),
            );
        } else {
            this.cursorPos = new MockQmlPoint(
                Math.round(frame.x + frame.width/2),
                Math.round(frame.y + frame.height/2),
            );
        }
        window.resize = true;
        window.interactiveMoveResizeStarted.fire();

        for (const delta of deltas) {
            if (delta.width !== 0) {
                frame.width += delta.width;
                if (leftEdge) {
                    frame.x -= delta.width;
                }
            }
            if (delta.height !== 0) {
                frame.height += delta.height;
                if (topEdge) {
                    frame.y -= delta.height;
                }
            }
            runOneOf(
                () => window.getActualFrameGeometry().set(frame),
                () => window.frameGeometry = frame,
            );
        }

        window.resize = false;
        window.interactiveMoveResizeFinished.fire();
    }

    public get currentDesktop() {
        return this._currentDesktop;
    }

    public set currentDesktop(currentDesktop: KwinDesktop) {
        this._currentDesktop = currentDesktop;
        this.currentDesktopChanged.fire();
    }

    public get activeWindow() {
        return this._activeWindow;
    }

    public set activeWindow(activeWindow: KwinClient|null) {
        this._activeWindow = activeWindow;
        if (activeWindow !== null) {
            // the screen the user is working on is the one holding the focused window
            this.activeScreen = this.getKnownOutput(activeWindow.output);
        }
        this.windowActivated.fire(activeWindow);
    }
}
