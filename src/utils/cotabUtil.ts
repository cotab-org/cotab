

export class SimpleLocker {
    private locked = false;
    public async acquireLock() {
        while (this.locked) {
            await new Promise(r => setTimeout(r, 10)); // wait
        }
        this.locked = true;
    }
    public releaseLock() {
        this.locked = false;
    }

    public isLocked(): boolean {
        return this.locked;
    }
};
