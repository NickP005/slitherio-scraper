/*
RUN
npm install sharp                                                           
node generate-icons.js
*/

const sharp = require('sharp');
const fs = require('fs');

const sizes = [16, 32, 48, 128];
const svgPath = 'icon.svg';

async function generateIcons() {
    for (const size of sizes) {
        try {
            await sharp(svgPath)
                .resize(size, size)
                .png()
                .toFile(`icon${size}.png`);
            
            console.log(`✓ Generated icon${size}.png`);
        } catch (error) {
            console.error(`✗ Failed to generate icon${size}.png:`, error);
        }
    }
}

generateIcons();

