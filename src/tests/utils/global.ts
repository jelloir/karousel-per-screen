let Qt: Qt;
let KWin: KWin;
let Workspace: Workspace;
let qmlBase: QmlObject;
let notificationInvalidTiledDesktops: Notification;
let notificationInvalidWindowRules: Notification;
let notificationInvalidPresetWidths: Notification;
let moveCursorToFocus: DBusCall;

let screen: MockQmlRect;
let screens: MockQmlRect[];
let tilingArea: MockQmlRect;
let tilingAreas: MockQmlRect[];
let gapH: number;
let gapV: number;
let runLog: string[];

// `screenGeometries` defaults to a single screen, which is what all single-screen tests expect.
// Pass several to test per-screen grids; `screen` then refers to the first one.
function init(config: Config, screenGeometries?: MockQmlRect[]) {
    screens = screenGeometries ?? [new MockQmlRect(0, 0, 800, 600)];
    screen = screens[0];
    tilingAreas = screens.map(s => new MockQmlRect(
        s.x + config.gapsOuterLeft,
        s.y + config.gapsOuterTop,
        s.width - config.gapsOuterLeft - config.gapsOuterRight,
        s.height - config.gapsOuterTop - config.gapsOuterBottom,
    ));
    tilingArea = tilingAreas[0];
    gapH = config.gapsInnerHorizontal;
    gapV = config.gapsInnerVertical;
    runLog = [];

    const qtMock = new MockQt();
    const workspaceMock = new MockWorkspace(screens);

    Qt = qtMock;
    Workspace = workspaceMock;
    moveCursorToFocus = {
        __brand: "QmlObject",
        call: () => {
            Assert.assert(Workspace.activeWindow !== null, { message: "moveCursorToFocus should never be called if there's no focused window" });
            const frame = (Workspace.activeWindow! as MockKwinClient).getActualFrameGeometry();
            workspaceMock.cursorPos.x = Math.floor(frame.x + frame.width/2);
            workspaceMock.cursorPos.y = Math.floor(frame.y + frame.height/2);
        },
    };


    const world = new World(config);
    return { qtMock, workspaceMock, world };
}

function getGridBounds(clientLeft: MockKwinClient, clientRight: MockKwinClient) {
    const columnsWidth = rectRight(clientRight.getActualFrameGeometry()) - clientLeft.getActualFrameGeometry().x;
    const left = tilingArea.x + Math.floor((tilingArea.width - columnsWidth) / 2);
    const right = left + columnsWidth;
    return { left, right };
}

function getWindowHeight(windowsInColumn: number) {
    const totalGaps = (windowsInColumn-1) * gapV;
    return Math.round((tilingArea.height - totalGaps) / windowsInColumn);
}

function getClientManager(world: World): ClientManager {
    // don't do this outside of tests
    let clientManager;
    world.do((cm, dm) => clientManager = cm);
    return clientManager!;
}

function getDesktopManager(world: World): DesktopManager {
    // don't do this outside of tests
    let desktopManager;
    world.do((cm, dm) => desktopManager = dm);
    return desktopManager!;
}

function activateRandomWindowOnDesktop(desktop: KwinDesktop) {
    const windows = Workspace.windows.filter(w => w.desktops.includes(desktop));
    if (windows.length > 0) {
        Workspace.activeWindow = randomItem(windows);
    }
}
