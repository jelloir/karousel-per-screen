class DesktopManager {
    private readonly desktops: Map<string, Desktop>; // key is activityId|desktopId|screenName
    private screens: Map<string, Output>; // key is screen name
    private kwinActivities: Set<string>;
    private kwinDesktops: Set<KwinDesktop>;

    constructor(
        private readonly pinManager: PinManager,
        private readonly config: Desktop.Config,
        private readonly layoutConfig: LayoutConfig,
        private readonly focusPasser: FocusPassing.Passer,
        private readonly desktopFilter: DesktopFilter,
    ) {
        this.pinManager = pinManager;
        this.config = config;
        this.layoutConfig = layoutConfig;
        this.desktops = new Map();
        this.screens = DesktopManager.getKwinScreens();
        this.kwinActivities = new Set(Workspace.activities);
        this.kwinDesktops = new Set(Workspace.desktops);
    }

    public getDesktop(activity: string, kwinDesktop: KwinDesktop, screen: Output) {
        if (!this.desktopFilter.shouldWorkOnDesktop(kwinDesktop)) {
            return undefined;
        }
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop, screen);
        const desktop = this.desktops.get(desktopKey);
        if (desktop !== undefined) {
            return desktop;
        } else {
            return this.addDesktop(activity, kwinDesktop, screen);
        }
    }

    // the desktop of the screen the user is currently working on
    public getCurrentDesktop() {
        return this.getDesktop(Workspace.currentActivity, Workspace.currentDesktop, this.getActiveScreen());
    }

    // one desktop per screen, so that every screen gets arranged
    public *getCurrentDesktops() {
        for (const screen of this.screens.values()) {
            const desktop = this.getDesktop(Workspace.currentActivity, Workspace.currentDesktop, screen);
            if (desktop !== undefined) {
                yield desktop;
            }
        }
    }

    public getDesktopInCurrentActivity(kwinDesktop: KwinDesktop, screen: Output = this.getActiveScreen()) {
        return this.getDesktop(Workspace.currentActivity, kwinDesktop, screen);
    }

    public getDesktopForClient(kwinClient: KwinClient, screen: Output = this.getScreenForClient(kwinClient)) {
        if (kwinClient.activities.length !== 1 || kwinClient.desktops.length !== 1) {
            return undefined;
        }
        return this.getDesktop(kwinClient.activities[0], kwinClient.desktops[0], screen);
    }

    // KWin may report an output that has since been unplugged, so fall back to the active screen.
    public getScreenForClient(kwinClient: KwinClient) {
        const output = kwinClient.output;
        if (output === undefined || output === null) {
            return this.getActiveScreen();
        }
        return this.screens.get(output.name) ?? this.getActiveScreen();
    }

    // The screen showing the biggest part of `frame`, or null if it is outside of every screen.
    // KWin only updates a window's `output` once its geometry has settled, so right after a window
    // has been moved the geometry is the more reliable source.
    public getScreenForGeometry(frame: QmlRect): Output|null {
        let bestScreen: Output|null = null;
        let bestArea = 0;
        for (const screen of this.screens.values()) {
            const area = rectIntersectionArea(frame, screen.geometry);
            if (area > bestArea) {
                bestArea = area;
                bestScreen = screen;
            }
        }
        return bestScreen;
    }

    private getActiveScreen() {
        const activeScreen = Workspace.activeScreen;
        const knownScreen = activeScreen === undefined || activeScreen === null ?
            undefined :
            this.screens.get(activeScreen.name);
        if (knownScreen !== undefined) {
            return knownScreen;
        }
        // should never happen, but we must always return a usable screen
        const firstScreen = this.screens.values().next();
        return firstScreen.done ? activeScreen : firstScreen.value;
    }

    private addDesktop(activity: string, kwinDesktop: KwinDesktop, screen: Output) {
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop, screen);
        // The desktop resolves its screen by name on every arrange, so a replaced `Output` object
        // is picked up without the manager having to push it.
        const screenName = screen.name;
        const desktop = new Desktop(
            kwinDesktop,
            this.pinManager,
            this.config,
            () => this.screens.get(screenName) ?? this.getActiveScreen(),
            this.layoutConfig,
            this.focusPasser,
        );
        this.desktops.set(desktopKey, desktop);
        return desktop;
    }

    private static getDesktopKey(activity: string, kwinDesktop: KwinDesktop, screen: Output) {
        return activity + "|" + kwinDesktop.id + "|" + screen.name;
    }

    private static getKwinScreens() {
        const screens = new Map<string, Output>();
        for (const screen of Workspace.screens) {
            screens.set(screen.name, screen);
        }
        if (screens.size === 0) {
            // should never happen, but we must always have at least one screen to work with
            const activeScreen = Workspace.activeScreen;
            screens.set(activeScreen.name, activeScreen);
        }
        return screens;
    }

    public updateActivities() {
        const newActivities = new Set(Workspace.activities);
        for (const activity of this.kwinActivities) {
            if (!newActivities.has(activity)) {
                this.removeActivity(activity);
            }
        }
        this.kwinActivities = newActivities;
    }

    public updateDesktops() {
        const newDesktops = new Set(Workspace.desktops);
        for (const desktop of this.kwinDesktops) {
            if (!newDesktops.has(desktop)) {
                this.removeKwinDesktop(desktop);
            }
        }
        this.kwinDesktops = newDesktops;
    }

    public updateScreens() {
        const newScreens = DesktopManager.getKwinScreens();
        const removedScreens: Output[] = [];
        for (const [name, screen] of this.screens) {
            if (!newScreens.has(name)) {
                removedScreens.push(screen);
            }
        }
        this.screens = newScreens;

        for (const screen of removedScreens) {
            this.removeScreen(screen);
        }
    }

    private removeActivity(activity: string) {
        for (const kwinDesktop of this.kwinDesktops) {
            for (const screen of this.screens.values()) {
                this.destroyDesktop(activity, kwinDesktop, screen);
            }
        }
    }

    private removeKwinDesktop(kwinDesktop: KwinDesktop) {
        for (const activity of this.kwinActivities) {
            for (const screen of this.screens.values()) {
                this.destroyDesktop(activity, kwinDesktop, screen);
            }
        }
    }

    // Windows of a disconnected screen are taken over by the grids of the screen that remains.
    private removeScreen(removedScreen: Output) {
        const fallbackScreen = this.getActiveScreen();
        for (const activity of this.kwinActivities) {
            for (const kwinDesktop of this.kwinDesktops) {
                const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop, removedScreen);
                const desktop = this.desktops.get(desktopKey);
                if (desktop === undefined) {
                    continue;
                }
                const fallbackDesktop = this.getDesktop(activity, kwinDesktop, fallbackScreen);
                if (fallbackDesktop !== undefined && fallbackDesktop !== desktop) {
                    desktop.grid.evacuate(fallbackDesktop.grid);
                }
                desktop.destroy();
                this.desktops.delete(desktopKey);
            }
        }
    }

    private destroyDesktop(activity: string, kwinDesktop: KwinDesktop, screen: Output) {
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop, screen);
        const desktop = this.desktops.get(desktopKey);
        if (desktop !== undefined) {
            desktop.destroy();
            this.desktops.delete(desktopKey);
        }
    }

    public destroy() {
        for (const desktop of this.desktops.values()) {
            desktop.destroy();
        }
    }

    public *getAllDesktops() {
        for (const desktop of this.desktops.values()) {
            yield desktop;
        }
    }

    public getDesktopsForClient(kwinClient: KwinClient) {
        const desktops = this.getDesktops(kwinClient.activities, kwinClient.desktops); // workaround for QTBUG-109880
        return desktops;
    }

    // empty array means all
    public *getDesktops(activities: string[], kwinDesktops: KwinDesktop[]) {
        const matchedActivities = activities.length > 0 ? activities : this.kwinActivities.keys();
        const matchedDesktops = kwinDesktops.length > 0 ? kwinDesktops : this.kwinDesktops.keys();
        for (const matchedActivity of matchedActivities) {
            for (const matchedDesktop of matchedDesktops) {
                for (const screen of this.screens.values()) {
                    const desktopKey = DesktopManager.getDesktopKey(matchedActivity, matchedDesktop, screen);
                    const desktop = this.desktops.get(desktopKey);
                    if (desktop !== undefined) {
                        yield desktop;
                    }
                }
            }
        }
    }
}
