// lights.js
import * as THREE from "https://esm.sh/three@0.129.0";
import { RectAreaLightUniformsLib } from "https://esm.sh/three@0.129.0/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { RectAreaLightHelper } from "https://esm.sh/three@0.129.0/examples/jsm/helpers/RectAreaLightHelper.js";

export function setupSceneLights(scene) {
// Lights   
RectAreaLightUniformsLib.init();
const ambientLight = new THREE.AmbientLight(0x004D4D, 0.2);
scene.add(ambientLight);

// Section: TV Top Light
const tvTopLight = new THREE.PointLight(0xffffff, 15, 5); // White, Intensity 15, Range 10
tvTopLight.position.set(0, 5, -7); // Position it directly above the TV (adjust -7 to match TV Z)
tvTopLight.castShadow = true;
tvTopLight.shadow.mapSize.width = 1024;
tvTopLight.shadow.mapSize.height = 1024;
tvTopLight.shadow.bias = -0.0005; // Adjust bias to reduce shadow acne
scene.add(tvTopLight);

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

// The "Sun" Light — a strong point light that casts long shadows and gives depth to the scene
const sunLight = new THREE.PointLight(0xffffff, 2, 500);
sunLight.position.set(0, 100, -5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024; 
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

// // 3. THE TV SOFTBOX (RectAreaLight)
const helperVisability = false;

const rectLight = new THREE.RectAreaLight(0x00ff00, 1, 1.75, 1.5);
rectLight.position.set(0, 0.8, -6); // Flush against the glass
rectLight.lookAt(0, 0.8, 0); // Pointing forward at the tapes
scene.add(rectLight);

// const helperRect = new RectAreaLightHelper(rectLight);  
// scene.add(helperRect);

const tvRimLight = new THREE.RectAreaLight(0xCFFFD2, 25, 2, 0.5);
tvRimLight.position.set(0, 2.3, -6); // Just above the TV and slightly forward    
tvRimLight.lookAt(0, 1.5, -7); // Pointing forward at the tapes
scene.add(tvRimLight);
// Change this line
const helper = new RectAreaLightHelper(tvRimLight);  
scene.add(helper);
helper.visible = helperVisability; // Hide the helper by default, toggle to true for debugging

const tvRimLight1 = new THREE.RectAreaLight(0x3F755A, 40, 0.5, 1.5);
tvRimLight1.position.set(1.5, 1, -7); // Just above the TV and slightly forward    
tvRimLight1.lookAt(0, 1, -8); // Pointing forward at the tapes
scene.add(tvRimLight1);
// Change this line
const helper1 = new RectAreaLightHelper(tvRimLight1);  
scene.add(helper1);
helper1.visible = helperVisability; // Hide the helper by default, toggle to true for debugging

const tvRimLight7 = new THREE.RectAreaLight(0x3F755A, 40, 0.5, 1.5);
tvRimLight7.position.set(1.5, 1, -7); // Just above the TV and slightly forward    
tvRimLight7.lookAt(0, 1, -8); // Pointing forward at the tapes
scene.add(tvRimLight7);
// Change this line
const helper7 = new RectAreaLightHelper(tvRimLight7);  
scene.add(helper7);
helper7.visible = helperVisability; // Hide the helper by default, toggle to true for debugging


const tvRimLight2 = new THREE.RectAreaLight(0x3F755A, 40, 0.5, 1.5);
tvRimLight2.position.set(-1.5, 1, -7); // Just above the TV and slightly forward    
tvRimLight2.lookAt(0, 1, -8); // Pointing forward at the tapes
scene.add(tvRimLight2);
// Change this line
const helper2 = new RectAreaLightHelper(tvRimLight2);  
scene.add(helper2);
helper2.visible = helperVisability; // Hide the helper by default, toggle to true for debugging

const tvRimLight3 = new THREE.RectAreaLight(0xCFFFD2, 5, 1, 0.5);
tvRimLight3.position.set(0, 0.5, -6.5); // Just above the TV and slightly forward    
tvRimLight3.lookAt(0, 0, -7); // Pointing forward at the tapes
scene.add(tvRimLight3);
// Change this line
const helper3 = new RectAreaLightHelper(tvRimLight3);  
scene.add(helper3);
helper3.visible = helperVisability; // Hide the helper by default, toggle to true for debugging

const tableRimLight2 = new THREE.RectAreaLight(0x3F755A, 15, 5, 0.25);
tableRimLight2.position.set(0, -0.7, 1); // Lower and further forward
tableRimLight2.lookAt(0, 1,0); // Points back toward the TV
scene.add(tableRimLight2);

const helper4 = new RectAreaLightHelper(tableRimLight2);
scene.add(helper4);
helper4.visible = helperVisability; // Hide the helper by default, toggle to true for debugging

const tvRimLight5 = new THREE.RectAreaLight(0x00ff00, 15, 0.5, 1.5);
tvRimLight5.position.set(0, 1, -6.5); // Just above the TV and slightly forward    
tvRimLight5.lookAt(0, 0, -6.5); // Pointing forward at the tapes
scene.add(tvRimLight5);

const helper5 = new RectAreaLightHelper(tvRimLight5);  
scene.add(helper5);
helper5.visible = helperVisability; // Hide the helper by default, toggle to true for debugging

}