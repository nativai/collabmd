export class RoomRegistry {
  constructor({ createRoom }) {
    this.createRoom = createRoom;
    this.rooms = new Map();
  }

  getOrCreate(name) {
    if (!this.rooms.has(name)) {
      const room = this.createRoom({
        name,
        onEmpty: (roomName) => {
          this.rooms.delete(roomName);
        },
      });

      this.rooms.set(name, room);
    }

    return this.rooms.get(name);
  }
}
