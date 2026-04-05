// lights.js
import * as THREE from "https://esm.sh/three@0.129.0";
import { RectAreaLightUniformsLib } from "https://esm.sh/three@0.129.0/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { RectAreaLightHelper } from "https://esm.sh/three@0.129.0/examples/jsm/helpers/RectAreaLightHelper.js";

export function setupSceneLights(scene) {
// Lights   
RectAreaLightUniformsLib.init();
const ambientLight = new THREE.AmbientLight(0x004D4D, 0.2);
scene.add(ambientLight);



//  Section: Tape Lights — a point light for each tape, giving them that "glow" and making them pop off the table
const tapeLight = new THREE.PointLight(0xffffff, 0.4, 5); 
tapeLight.position.set(0, 0.5, 2);
tapeLight.castShadow = true;
tapeLight.shadow.mapSize.width = 512;
tapeLight.shadow.mapSize.height = 512;
tapeLight.shadow.bias = -0.0005;
scene.add(tapeLight);

// Optional: A RectAreaLight for softer, more natural lighting on the tapes (doesn't cast shadows but adds nice fill)
const tapeLightRect = new THREE.RectAreaLight(0xffffff, 5, 4, 2);
tapeLightRect.position.set(0, 3, 2);
tapeLightRect.lookAt(0, 0, 0);
scene.add(tapeLightRect);

const helperVisability = false;

const rectLight = new THREE.RectAreaLight(0xffffff, 1, 1.75, 1.5);
rectLight.position.set(0, 0.8, -6); // Flush against the glass
rectLight.lookAt(0, 0.8, 0); // Pointing forward at the tapes
scene.add(rectLight);

const tvRimLight7 = new THREE.RectAreaLight(0x3F755A, 40, 0.5, 1.5);
tvRimLight7.position.set(1.5, 1, -7); // Just above the TV and slightly forward    
tvRimLight7.lookAt(0, 1, -8); // Pointing forward at the tapes
scene.add(tvRimLight7);
// Change this line
const helper7 = new RectAreaLightHelper(tvRimLight7);  
scene.add(helper7);
helper7.visible = helperVisability; // Hide the helper by default, toggle to true for debugging


const tableRimLight2 = new THREE.RectAreaLight(0x3F755A, 15, 5, 0.25);
tableRimLight2.position.set(0, -0.7, 1); // Lower and further forward
tableRimLight2.lookAt(0, 1,0); // Points back toward the TV
scene.add(tableRimLight2);

const helper4 = new RectAreaLightHelper(tableRimLight2);
scene.add(helper4);
helper4.visible = helperVisability; // Hide the helper by default, toggle to true for debugging

}