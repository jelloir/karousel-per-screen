// One Karousel grid per screen: every screen tiles independently, and a window follows the
// screen it is moved to.
//
// Both screen arrangements matter. Stacked screens hide overflow for free, because a column
// scrolled off an edge lands where no screen is. Side by side, the space past a screen's edge IS
// the neighbouring screen, so a scrolled-off column must stay in its own grid (and is hidden
// there by the clip2output effect).

function sideBySideScreens() {
    return [
        new MockQmlRect(0, 0, 800, 600),
        new MockQmlRect(800, 0, 800, 600),
    ];
}

function stackedScreens() {
    return [
        new MockQmlRect(0, 0, 800, 600),
        new MockQmlRect(0, 600, 800, 600),
    ];
}

// creates one window whose initial geometry places it on the given screen
function createClientOnScreen(workspaceMock: MockWorkspace, screenRect: QmlRect, width = 100) {
    return workspaceMock.createClientsWithFrames(
        new MockQmlRect(screenRect.x + 10, screenRect.y + 10, width, 200),
    )[0];
}

function assertOnScreen(client: MockKwinClient, screenRect: QmlRect, message: string) {
    const frame = client.getActualFrameGeometry();
    Assert.assert(
        frame.y >= screenRect.y && rectBottom(frame) <= rectBottom(screenRect),
        { message: `${message}: ${client} at ${frame} is not on screen ${screenRect}` },
    );
}

tests.register("Per-screen containment", 10, () => {
    const config = getDefaultConfig();
    const { workspaceMock } = init(config, stackedScreens());
    const [screen0, screen1] = screens;

    const client0 = createClientOnScreen(workspaceMock, screen0);
    const client1 = createClientOnScreen(workspaceMock, screen1);

    assertOnScreen(client0, screen0, "window created on screen 1");
    assertOnScreen(client1, screen1, "window created on screen 2");

    // each screen's grid is laid out within its own tiling area, independently of the other
    Assert.centered(config, tilingAreas[0], client0);
    Assert.centered(config, tilingAreas[1], client1);

    // adding a window to one screen must not disturb the other screen
    const frameBefore = client0.getFrameGeometryCopy();
    const client2 = createClientOnScreen(workspaceMock, screen1);
    Assert.equalRects(client0.getActualFrameGeometry(), frameBefore, { message: "screen 1 disturbed by a window added to screen 2" });
    assertOnScreen(client2, screen1, "second window on screen 2");
    assertOnScreen(client1, screen1, "first window on screen 2");
});

tests.register("A window moved to another screen joins that screen's grid", 10, () => {
    const config = getDefaultConfig();
    const { workspaceMock, world } = init(config, stackedScreens());
    const [screen0, screen1] = screens;
    const desktopManager = getDesktopManager(world);

    const client = createClientOnScreen(workspaceMock, screen0);
    Assert.equal(
        desktopManager.getScreenForClient(client).name,
        workspaceMock.screens[0].name,
        { message: "window did not start on screen 1" },
    );

    // KWin's own "Window to Next Screen" moves the geometry first and only updates the window's
    // `output` once it has settled. Hold the output stale across the move, so that the new screen
    // can only be found from the geometry -- reading `kwinClient.output` here would still name
    // screen 1 and snap the window back into the grid it came from.
    client.deferOutputUpdate = true;
    client.frameGeometry = new MockQmlRect(screen1.x + 20, screen1.y + 20, 100, 200);

    Assert.equal(
        client.output.name,
        workspaceMock.screens[0].name,
        { message: "the test is not exercising the stale-output window any more" },
    );
    assertOnScreen(client, screen1, "window moved to screen 2 while its output was stale");
    Assert.centered(config, tilingAreas[1], client);

    // The clip2output effect must have been told, or it would keep clipping the window to the
    // screen it came from and the window would be invisible on its new one.
    Assert.assert(
        clipOwnerLog.length >= 1
            && clipOwnerLog[clipOwnerLog.length - 1].endsWith(" -> " + workspaceMock.screens[1].name),
        { message: `clip ownership was not handed to screen 2: ${JSON.stringify(clipOwnerLog)}` },
    );

    // once KWin catches up, nothing moves back
    client.settleOutput();
    Assert.equal(
        desktopManager.getScreenForClient(client).name,
        workspaceMock.screens[1].name,
        { message: "window did not stay on screen 2" },
    );
    assertOnScreen(client, screen1, "window after its output settled");
});

tests.register("Columns scrolled out of view stay in their own grid", 10, () => {
    const config = getDefaultConfig();
    const { workspaceMock, world } = init(config, stackedScreens());
    const [screen0, screen1] = screens;
    const desktopManager = getDesktopManager(world);

    // fill screen 1 until the row is wider than the screen, so the first column scrolls off it
    const clients = [];
    for (let i = 0; i < 4; i++) {
        clients.push(createClientOnScreen(workspaceMock, screen0, 300));
    }
    // one window on the other screen, which must be left alone throughout
    const otherClient = createClientOnScreen(workspaceMock, screen1);
    const otherFrameBefore = otherClient.getFrameGeometryCopy();

    const scrolledOff = clients[0];
    const frame = scrolledOff.getActualFrameGeometry();
    Assert.assert(
        rectRight(frame) <= screen0.x || frame.x >= rectRight(screen0),
        { message: `expected the first column to be scrolled off screen 1, but it is at ${frame}` },
    );

    // A column parked outside of every screen must not be re-homed. Stacked screens share their x
    // range, so it is clipped rather than landing on the neighbouring monitor.
    Assert.equal(
        desktopManager.getScreenForGeometry(frame),
        null,
        { message: "a column scrolled out of view should be on no screen at all" },
    );
    Assert.equalRects(otherClient.getActualFrameGeometry(), otherFrameBefore,
        { message: "screen 2 was disturbed by screen 1 overflowing" });
});

tests.register("Unplugging a screen takes over its windows", 10, () => {
    const config = getDefaultConfig();
    const { workspaceMock, world } = init(config, stackedScreens());
    const [screen0, screen1] = screens;
    const desktopManager = getDesktopManager(world);

    const client0 = createClientOnScreen(workspaceMock, screen0);
    const client1 = createClientOnScreen(workspaceMock, screen1);

    // unplug the second monitor
    workspaceMock.setScreens([screen0]);

    Assert.equal(workspaceMock.screens.length, 1, { message: "second screen was not removed" });
    assertOnScreen(client0, screen0, "window that was already on screen 1");
    assertOnScreen(client1, screen0, "window evacuated from the unplugged screen");
    Assert.equal(
        desktopManager.getScreenForClient(client1).name,
        workspaceMock.screens[0].name,
        { message: "evacuated window did not join the remaining screen's grid" },
    );

    // The clip effect's ownership is sticky, so the evacuation must announce the new screen -
    // otherwise the window stays clipped to an output that no longer exists, i.e. invisible.
    const client1Announcements = clipOwnerLog.filter(entry => entry.startsWith(String(client1.internalId) + " ->"));
    Assert.assert(
        client1Announcements.length >= 1
            && client1Announcements[client1Announcements.length - 1].endsWith(" -> " + workspaceMock.screens[0].name),
        { message: `clip ownership was not re-announced on evacuation: ${JSON.stringify(clipOwnerLog)}` },
    );
});

tests.register("Side by side: a column scrolled off an edge stays in its own grid", 10, () => {
    const config = getDefaultConfig();
    const { workspaceMock } = init(config, sideBySideScreens());
    const [screen0, screen1] = screens;

    // one window on screen 2, which must be left completely alone
    const otherClient = createClientOnScreen(workspaceMock, screen1);
    const otherFrameBefore = otherClient.getFrameGeometryCopy();

    // fill screen 1 until its row overflows; side by side, the space it overflows into is screen 2
    const clients = [];
    for (let i = 0; i < 4; i++) {
        clients.push(createClientOnScreen(workspaceMock, screen0, 300));
    }

    const scrolledOff = clients[clients.length - 1];

    // KWin re-attributes a window to another output only once its geometry has settled, so the
    // `outputChanged` for a parked column arrives AFTER Karousel has finished placing it - when
    // the "Karousel is placing it right now" guard no longer applies. Hold the output stale across
    // the scroll and settle it afterwards, which is the real-world ordering.
    scrolledOff.deferOutputUpdate = true;

    // Focus the first column so the row scrolls back, pushing the LAST columns off screen 1's
    // right edge - which, side by side, is where screen 2 begins.
    workspaceMock.activeWindow = clients[0];

    scrolledOff.settleOutput();
    const frame = scrolledOff.getActualFrameGeometry();

    // the test is only meaningful if the column really is parked over the neighbouring output,
    // which is the situation the stacked arrangement never produces
    Assert.assert(
        rectIntersectionArea(frame, screen1) > 0,
        { message: `expected the scrolled-off column to be parked over screen 2, but it is at ${frame}` },
    );

    // The mock must have re-attributed the parked column to screen 2, or this test is not
    // exercising the re-homing path at all.
    Assert.equal(
        scrolledOff.output.name,
        workspaceMock.screens[1].name,
        { message: `parked column at ${frame} was not re-attributed to screen 2` },
    );

    // Screen 2 must be untouched. If the parked column were followed to screen 2, it would join
    // that grid, and the window already there would be re-laid out to make room for it.
    Assert.equalRects(
        otherClient.getActualFrameGeometry(),
        otherFrameBefore,
        { message: "screen 2's grid took over a column that screen 1 had merely scrolled off" },
    );
    Assert.centered(config, tilingAreas[1], otherClient);
});

tests.register("Clip claim follows the tiled state: released on float, restored on re-tile", 10, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock } = init(config, sideBySideScreens());
    const [screen0] = screens;

    const client = createClientOnScreen(workspaceMock, screen0);
    const screen0Name = workspaceMock.screens[0].name;
    const id = String(client.internalId);
    const claims = () => clipOwnerLog.filter(entry => entry.startsWith(id + " ->"));

    // tiling must have claimed the window for its screen
    Assert.assert(
        claims().length >= 1 && claims()[claims().length - 1] === `${id} -> ${screen0Name}`,
        { message: `tiling did not claim the window: ${JSON.stringify(clipOwnerLog)}` },
    );

    // Floating hands the window back to the user, so the claim must be released (empty owner) -
    // otherwise a floating window dropped across the seam has its far half clipped invisible.
    workspaceMock.activeWindow = client;
    qtMock.fireShortcut("karousel-window-toggle-floating");
    Assert.equal(
        claims()[claims().length - 1],
        `${id} -> `,
        { message: `floating did not release the clip claim: ${JSON.stringify(clipOwnerLog)}` },
    );

    // and tiling it again must re-claim it
    qtMock.fireShortcut("karousel-window-toggle-floating");
    Assert.equal(
        claims()[claims().length - 1],
        `${id} -> ${screen0Name}`,
        { message: `re-tiling did not re-claim the window: ${JSON.stringify(clipOwnerLog)}` },
    );
});
