tests.register("column width constraints on window added", 5, () => {
    // moving a window into a column applies that window's max width to the column
    {
        const config = getDefaultConfig();
        const { qtMock, workspaceMock, world } = init(config);
        const assertOpt = { message: "max width" };

        const clients = workspaceMock.createClientsWithWidths(500, 100);
        clients[1].maxSize = new MockQmlSize(300, 9999);

        workspaceMock.activeWindow = clients[1];
        qtMock.fireShortcut("karousel-window-move-left");

        Assert.equal(clients[0].getActualFrameGeometry().width, 300, assertOpt);
        Assert.equal(clients[1].getActualFrameGeometry().width, 300, assertOpt);
    }

    // moving a window into a column applies that window's min width to the column
    {
        const config = getDefaultConfig();
        const { qtMock, workspaceMock, world } = init(config);
        const assertOpt = { message: "min width" };

        const clients = workspaceMock.createClientsWithWidths(200, 100);
        clients[1].minSize = new MockQmlSize(400, 100);

        workspaceMock.activeWindow = clients[1];
        qtMock.fireShortcut("karousel-window-move-left");

        Assert.equal(clients[0].getActualFrameGeometry().width, 400, assertOpt);
        Assert.equal(clients[1].getActualFrameGeometry().width, 400, assertOpt);
    }
});
