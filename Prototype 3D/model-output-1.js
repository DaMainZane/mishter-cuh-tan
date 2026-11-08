function buildSettlement(p) {
  const group = new THREE.Group();
  group.position.set(p.x, 0, p.z);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.3), RED);
  body.position.y = 0.18;
  group.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.2, 4), DARK);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.36;
  group.add(roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.025), LIGHT);
  door.position.set(0, 0.19, 0.16);
  group.add(door);

  addRim(group);
  return group;
}

function buildCity(p) {
  const group = new THREE.Group();
  group.position.set(p.x, 0, p.z);
  group.scale.setScalar(1.3);

  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.55, 0.26), RED);
  tower.position.set(-0.14, 0.275, 0);
  group.add(tower);

  const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.24, 4), DARK);
  towerRoof.rotation.y = Math.PI / 4;
  towerRoof.position.set(-0.14, 0.58, 0);
  group.add(towerRoof);

  const house = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.3), RED);
  house.position.set(0.17, 0.27, 0);
  group.add(house);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.2, 4), DARK);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0.17, 0.45, 0);
  group.add(roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.025), LIGHT);
  door.position.set(0.17, 0.3, 0.16);
  group.add(door);

  addRim(group);
  return group;
}

function buildRoad(p1, p2) {
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  const length = Math.hypot(dx, dz);
  const geometry = new THREE.CapsuleGeometry(0.075, Math.max(0.01, length * 0.8 - 0.14), 6, 12);
  geometry.rotateX(Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, RED);
  mesh.position.set((p1.x + p2.x) / 2, 0.39, (p1.z + p2.z) / 2);
  scene.add(mesh);
  mesh.lookAt(p2.x, 0.4, p2.z);
  addRim(mesh);
  return mesh;
}
