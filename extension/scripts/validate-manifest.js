const fs = require('fs');
const path = require('path');

function validateManifest() {
    try {
        const manifestPath = path.join(__dirname, '../dist/manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        
        // Validate required fields
        const required = ['manifest_version', 'name', 'version', 'description'];
        for (const field of required) {
            if (!manifest[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        // Validate manifest version
        if (manifest.manifest_version !== 3) {
            throw new Error('Extension must use Manifest V3');
        }
        
        // Validate permissions
        if (!manifest.permissions || !Array.isArray(manifest.permissions)) {
            throw new Error('Permissions must be an array');
        }
        
        // Validate content scripts
        if (!manifest.content_scripts || !Array.isArray(manifest.content_scripts)) {
            throw new Error('Content scripts must be defined');
        }
        
        // Check if all referenced files exist
        const files = [];
        
        // Add content script files
        manifest.content_scripts.forEach(cs => {
            if (cs.js) files.push(...cs.js);
            if (cs.css) files.push(...cs.css);
        });
        
        // Add background script
        if (manifest.background && manifest.background.service_worker) {
            files.push(manifest.background.service_worker);
        }
        
        // Add popup files
        if (manifest.action && manifest.action.default_popup) {
            files.push(manifest.action.default_popup);
        }
        
        // Add icons
        if (manifest.icons) {
            files.push(...Object.values(manifest.icons));
        }
        
        // Add web accessible resources
        if (manifest.web_accessible_resources) {
            manifest.web_accessible_resources.forEach(war => {
                if (war.resources) files.push(...war.resources);
            });
        }
        
        // Check file existence
        const distPath = path.join(__dirname, '../dist');
        for (const file of files) {
            const filePath = path.join(distPath, file);
            if (!fs.existsSync(filePath)) {
                console.warn(`Warning: Referenced file not found: ${file}`);
            }
        }
        
        console.log('✅ Manifest validation passed');
        console.log(`📦 Extension: ${manifest.name} v${manifest.version}`);
        console.log(`📝 Description: ${manifest.description}`);
        
        return true;
    } catch (error) {
        console.error('❌ Manifest validation failed:', error.message);
        process.exit(1);
    }
}

validateManifest();