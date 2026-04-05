// lights.js
import * as THREE from "https://esm.sh/three@0.129.0";
import { RectAreaLightUniformsLib } from "https://esm.sh/three@0.129.0/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { RectAreaLightHelper } from "https://esm.sh/three@0.129.0/examples/jsm/helpers/RectAreaLightHelper.js";

export function setupSceneLights(scene) {
// Lights   
RectAreaLightUniformsLib.init();
const ambientLight = new THREE.AmbientLight(0x004D4D, 0.2);
scene.add(ambientLight);



const rectLight = new THREE.RectAreaLight(0xFFFFFF, 1, 4, 4);
rectLight.position.set(0, 5, 0);
rectLight.lookAt(0, 0, 0);
scene.add(rectLight);
}