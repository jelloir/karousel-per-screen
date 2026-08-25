interface DBusCall extends QmlObject {
    arguments: string[];
    call(): void;
}
