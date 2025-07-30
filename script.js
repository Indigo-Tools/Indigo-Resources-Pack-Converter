const themeToggle = document.getElementById('themeToggle');
const body = document.body;

function applyTheme(theme) {
    body.classList.remove('light', 'dark');
    body.classList.add(theme);
    localStorage.setItem('theme', theme);
}

const savedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

if (savedTheme) {
    applyTheme(savedTheme);
} else if (prefersDark.matches) {
    applyTheme('dark');
} else {
    applyTheme('light');
}

prefersDark.addEventListener('change', (event) => {
    if (!localStorage.getItem('theme')) {
        applyTheme(event.matches ? 'dark' : 'light');
    }
});

themeToggle.addEventListener('click', () => {
    if (body.classList.contains('light')) {
        applyTheme('dark');
    } else {
        applyTheme('light');
    }
});

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0,
            v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function parseJavaPackMcmeta(mcmetaContent) {
    try {
        const data = JSON.parse(mcmetaContent);
        const packFormat = data?.pack?.pack_format;
        const description = data?.pack?.description;
        return { packFormat, description };
    } catch (e) {
        console.error("Error parsing pack.mcmeta:", e);
        return null;
    }
}

function parseBedrockManifest(manifestContent) {
    try {
        const data = JSON.parse(manifestContent);
        const name = data?.header?.name;
        const description = data?.header?.description;
        return { name, description };
    } catch (e) {
        console.error("Error parsing manifest.json:", e);
        return null;
    }
}

function createBedrockManifest(packName, packDescription, minimumEngineVersion = "1.20.0") {
    const headerUuid = generateUUID();
    const moduleUuid = generateUUID();
    const minEngineVersionArray = minimumEngineVersion.split('.').map(Number);

    const manifest = {
        "format_version": 2,
        "header": {
            "name": packName,
            "description": packDescription,
            "uuid": headerUuid,
            "version": [1, 0, 0],
            "min_engine_version": minEngineVersionArray
        },
        "modules": [{
            "description": packDescription,
            "type": "resources",
            "uuid": moduleUuid,
            "version": [1, 0, 0]
        }],
    };
    return JSON.stringify(manifest, null, 4);
}

function createJavaPackMcmeta(packName, packDescription, packFormat = 18) {
    const mcmeta = {
        "pack": {
            "pack_format": packFormat,
            "description": packDescription
        }
    };
    return JSON.stringify(mcmeta, null, 4);
}

function mapJavaToBedrockPath(javaPath) {
    javaPath = javaPath.replace(/\\/g, '/');

    if (javaPath === 'pack.png') {
        return 'pack_icon.png';
    }

    if (javaPath.startsWith('assets/minecraft/textures/')) {
        let bedrockPath = javaPath.replace('assets/minecraft/textures/', 'textures/');
        if (bedrockPath.includes('/block/')) {
            bedrockPath = bedrockPath.replace('/block/', '/blocks/');
        } else if (bedrockPath.includes('/item/')) {
            bedrockPath = bedrockPath.replace('/item/', '/items/');
        } else if (bedrockPath.includes('/entity/')) {
            bedrockPath = bedrockPath.replace('/entity/', '/entity/');
        }
        return bedrockPath;
    }
    return null;
}

function mapBedrockToJavaPath(bedrockPath) {
    bedrockPath = bedrockPath.replace(/\\/g, '/');

    if (bedrockPath === 'pack_icon.png') {
        return 'pack.png';
    }

    if (bedrockPath.startsWith('textures/')) {
        let javaPath = bedrockPath.replace('textures/', 'assets/minecraft/textures/');
        if (javaPath.includes('/blocks/')) {
            javaPath = javaPath.replace('/blocks/', '/block/');
        } else if (javaPath.includes('/items/')) {
            javaPath = javaPath.replace('/items/', '/item/');
        } else if (javaPath.includes('/entity/')) {
            javaPath = javaPath.replace('/entity/', '/entity/');
        }
        return javaPath;
    }

    if (bedrockPath.includes('manifest.json') ||
        bedrockPath.includes('terrain_texture.json') ||
        bedrockPath.includes('item_texture.json') ||
        bedrockPath.includes('flipbook_textures.json') ||
        bedrockPath.includes('textures_list.json')) {
        return null;
    }
    return null;
}

function generateBedrockTextureMappingJsons(convertedFilesMap) {
    const terrainTexturesData = {
        "resource_pack_name": "vanilla",
        "texture_name": "atlas.terrain",
        "padding": 8,
        "num_mip_levels": 4,
        "textures": []
    };
    const itemTexturesData = {
        "resource_pack_name": "vanilla",
        "texture_name": "atlas.items",
        "padding": 8,
        "num_mip_levels": 4,
        "textures": []
    };

    for (const javaPath in convertedFilesMap) {
        const bedrockPath = convertedFilesMap[javaPath];
        if (bedrockPath.includes('textures/blocks/')) {
            const textureId = bedrockPath.replace('textures/', '').replace('.png', '');
            if (!terrainTexturesData.textures.includes(textureId)) {
                terrainTexturesData.textures.push(textureId);
            }
        } else if (bedrockPath.includes('textures/items/')) {
            const textureId = bedrockPath.replace('textures/', '').replace('.png', '');
            if (!itemTexturesData.textures.includes(textureId)) {
                itemTexturesData.textures.push(textureId);
            }
        }
    }

    return {
        'textures/terrain_texture.json': JSON.stringify(terrainTexturesData, null, 4),
        'textures/item_texture.json': JSON.stringify(itemTexturesData, null, 4)
    };
}

async function convertJavaToBedrock(javaZipFile, uiElements) {
    const { fileNameDisplay, convertBtn, messageDiv, downloadLink, progressBarContainer, progressBar } = uiElements;

    messageDiv.textContent = 'Starting conversion...';
    messageDiv.style.color = '';
    progressBarContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    convertBtn.classList.add('animate-pulse-slow');
    downloadLink.classList.add('hidden');

    const newZip = new JSZip();
    let javaPackMcmetaContent = null;
    const convertedFilesMap = {};

    try {
        messageDiv.textContent = 'Unzipping Java pack... (0%)';
        const zip = await JSZip.loadAsync(javaZipFile, {
            update: function metadataUpdate(metadata) {
                const percent = metadata.percent;
                progressBar.style.width = percent + '%';
                messageDiv.textContent = `Unzipping Java pack: ${percent.toFixed(1)}%`;
            }
        });

        const packMcmetaEntry = zip.file('pack.mcmeta');
        if (!packMcmetaEntry) {
            throw new Error("Invalid Java resource pack: pack.mcmeta not found.");
        }
        javaPackMcmetaContent = await packMcmetaEntry.async("string");

        const packPngEntry = zip.file('pack.png');
        if (packPngEntry) {
            const packIconBlob = await packPngEntry.async("blob");
            newZip.file('pack_icon.png', packIconBlob);
            console.log("Copied pack.png to pack_icon.png");
        }

        const { packFormat, description } = parseJavaPackMcmeta(javaPackMcmetaContent);
        if (packFormat === null) {
            throw new Error("Could not parse pack.mcmeta. Aborting conversion.");
        }
        console.log(`Java Pack Format: ${packFormat}, Description: ${description}`);

        messageDiv.textContent = 'Mapping Java assets... (0%)';
        progressBar.style.width = '0%';

        const filesToProcess = [];
        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && relativePath !== 'pack.mcmeta' && relativePath !== 'pack.png') {
                filesToProcess.push({ relativePath, zipEntry });
            }
        });

        let processedCount = 0;
        for (const { relativePath, zipEntry } of filesToProcess) {
            const bedrockTargetPath = mapJavaToBedrockPath(relativePath);
            if (bedrockTargetPath) {
                const content = await zipEntry.async("blob");
                newZip.file(bedrockTargetPath, content);
                convertedFilesMap[relativePath] = bedrockTargetPath;
            }
            processedCount++;
            const progress = (processedCount / filesToProcess.length) * 100;
            progressBar.style.width = progress.toFixed(1) + '%';
            messageDiv.textContent = `Mapping Java assets: ${progress.toFixed(1)}%`;
        }

        const manifestContent = createBedrockManifest(
            `${description || 'Converted Pack'} (Converted by Indigo Tools)`,
            `Converted from Java Edition (Format ${packFormat || 'Unknown'}) by Indigo Tools`
        );
        newZip.file('manifest.json', manifestContent);
        console.log("Generated manifest.json for Bedrock pack.");

        const bedrockTextureMappingJsons = generateBedrockTextureMappingJsons(convertedFilesMap);
        for (const path in bedrockTextureMappingJsons) {
            newZip.file(path, bedrockTextureMappingJsons[path]);
            console.log(`Generated ${path}`);
        }

        console.warn("PBR conversion and Custom Entity Model conversion are not fully implemented in this client-side version due to complexity.");

        messageDiv.textContent = 'Zipping Bedrock pack... (0%)';
        progressBar.style.width = '0%';

        const content = await newZip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 9 },
            onUpdate: function (metadata) {
                const percent = metadata.percent;
                progressBar.style.width = percent + '%';
                messageDiv.textContent = `Zipping Bedrock pack: ${percent.toFixed(1)}%`;
            }
        });

        const downloadUrl = URL.createObjectURL(content);
        downloadLink.href = downloadUrl;
        downloadLink.download = `converted_${javaZipFile.name.replace('.zip', '')}.mcpack`;
        downloadLink.textContent = `Download ${downloadLink.download}`;
        downloadLink.classList.remove('hidden');

        messageDiv.textContent = 'Conversion complete! Click the download link.';
        messageDiv.style.color = '#22c55e';
        return downloadUrl;

    } catch (error) {
        console.error("Conversion error:", error);
        messageDiv.textContent = `Error during conversion: ${error.message}`;
        messageDiv.style.color = '#ef4444';
        downloadLink.classList.add('hidden');
        return null;
    } finally {
        convertBtn.disabled = false;
        convertBtn.classList.remove('animate-pulse-slow');
        progressBarContainer.classList.add('hidden');
    }
}

async function convertBedrockToJava(bedrockZipFile, uiElements) {
    const { fileNameDisplay, convertBtn, messageDiv, downloadLink, progressBarContainer, progressBar } = uiElements;

    messageDiv.textContent = 'Starting conversion...';
    messageDiv.style.color = '';
    progressBarContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    convertBtn.classList.add('animate-pulse-slow');
    downloadLink.classList.add('hidden');

    const newZip = new JSZip();
    let bedrockManifestContent = null;

    try {
        messageDiv.textContent = 'Unzipping Bedrock pack... (0%)';
        const zip = await JSZip.loadAsync(bedrockZipFile, {
            update: function metadataUpdate(metadata) {
                const percent = metadata.percent;
                progressBar.style.width = percent + '%';
                messageDiv.textContent = `Unzipping Bedrock pack: ${percent.toFixed(1)}%`;
            }
        });

        const manifestEntry = zip.file('manifest.json');
        if (!manifestEntry) {
            throw new Error("Invalid Bedrock resource pack: manifest.json not found.");
        }
        bedrockManifestContent = await manifestEntry.async("string");

        const packIconEntry = zip.file('pack_icon.png');
        if (packIconEntry) {
            const packPngBlob = await packIconEntry.async("blob");
            newZip.file('pack.png', packPngBlob);
            console.log("Copied pack_icon.png to pack.png");
        }

        const { name, description } = parseBedrockManifest(bedrockManifestContent);
        if (name === null) {
            throw new Error("Could not parse manifest.json. Aborting conversion.");
        }
        console.log(`Bedrock Pack Name: ${name}, Description: ${description}`);

        messageDiv.textContent = 'Mapping Bedrock assets... (0%)';
        progressBar.style.width = '0%';

        const filesToProcess = [];
        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && relativePath !== 'manifest.json' && relativePath !== 'pack_icon.png') {
                filesToProcess.push({ relativePath, zipEntry });
            }
        });

        let processedCount = 0;
        for (const { relativePath, zipEntry } of filesToProcess) {
            const javaTargetPath = mapBedrockToJavaPath(relativePath);
            if (javaTargetPath) {
                const content = await zipEntry.async("blob");
                newZip.file(javaTargetPath, content);
            }
            processedCount++;
            const progress = (processedCount / filesToProcess.length) * 100;
            progressBar.style.width = progress.toFixed(1) + '%';
            messageDiv.textContent = `Mapping Bedrock assets: ${progress.toFixed(1)}%`;
        }

        const mcmetaContent = createJavaPackMcmeta(
            `${name || 'Converted Pack'} (Converted by Indigo Tools)`,
            `Converted from Bedrock Edition by Indigo Tools`
        );
        newZip.file('pack.mcmeta', mcmetaContent);
        console.log("Generated pack.mcmeta for Java pack.");

        console.warn("PBR information from Bedrock is not converted to Java, as Java does not natively support PBR. Custom Entity Model conversion is not fully implemented in this client-side version due to complexity.");

        messageDiv.textContent = 'Zipping Java pack... (0%)';
        progressBar.style.width = '0%';

        const content = await newZip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 9 },
            onUpdate: function (metadata) {
                const percent = metadata.percent;
                progressBar.style.width = percent + '%';
                messageDiv.textContent = `Zipping Java pack: ${percent.toFixed(1)}%`;
            }
        });

        const downloadUrl = URL.createObjectURL(content);
        downloadLink.href = downloadUrl;
        downloadLink.download = `converted_${bedrockZipFile.name.replace('.mcpack', '').replace('.zip', '')}.zip`;
        downloadLink.textContent = `Download ${downloadLink.download}`;
        downloadLink.classList.remove('hidden');

        messageDiv.textContent = 'Conversion complete! Click the download link.';
        messageDiv.style.color = '#22c55e';
        return downloadUrl;

    } catch (error) {
        console.error("Conversion error:", error);
        messageDiv.textContent = `Error during conversion: ${error.message}`;
        messageDiv.style.color = '#ef4444';
        downloadLink.classList.add('hidden');
        return null;
    } finally {
        convertBtn.disabled = false;
        convertBtn.classList.remove('animate-pulse-slow');
        progressBarContainer.classList.add('hidden');
    }
}

function setupConverter(uploadInputId, convertButtonId, fileNameId, progressBarContainerId, progressBarId, statusMessageId, downloadLinkId, conversionFunction) {
    const uploadInput = document.getElementById(uploadInputId);
    const convertButton = document.getElementById(convertButtonId);
    const fileNameSpan = document.getElementById(fileNameId);
    const progressBarContainer = document.getElementById(progressBarContainerId);
    const progressBar = document.getElementById(progressBarId);
    const statusMessage = document.getElementById(statusMessageId);
    const downloadLink = document.getElementById(downloadLinkId);

    let selectedFile = null;

    const uiElements = {
        fileNameDisplay: fileNameSpan,
        convertBtn: convertButton,
        messageDiv: statusMessage,
        downloadLink: downloadLink,
        progressBarContainer: progressBarContainer,
        progressBar: progressBar
    };

    uploadInput.addEventListener('change', (event) => {
        selectedFile = event.target.files[0];
        if (selectedFile) {
            fileNameSpan.textContent = selectedFile.name;
            convertButton.disabled = false;
            statusMessage.textContent = `File selected: ${selectedFile.name}. Click Convert.`;
            statusMessage.style.color = '';
            downloadLink.classList.add('hidden');
            progressBarContainer.classList.add('hidden');
            progressBar.style.width = '0%';
            convertButton.classList.remove('animate-pulse-slow');
        } else {
            fileNameSpan.textContent = 'No file chosen';
            convertButton.disabled = true;
            statusMessage.textContent = 'Awaiting file upload...';
            statusMessage.style.color = '';
        }
    });

    convertButton.addEventListener('click', async () => {
        if (!selectedFile) {
            statusMessage.textContent = 'Please select a file first.';
            statusMessage.style.color = '#ef4444';
            return;
        }
        convertButton.disabled = true;
        await conversionFunction(selectedFile, uiElements);
    });

    convertButton.disabled = true;
}

setupConverter(
    'javaUpload',
    'convertJavaToBedrock',
    'javaFileName',
    'javaProgressBarContainer',
    'javaProgressBar',
    'javaStatusMessage',
    'javaDownloadLink',
    convertJavaToBedrock
);

setupConverter(
    'bedrockUpload',
    'convertBedrockToJava',
    'bedrockFileName',
    'bedrockProgressBarContainer',
    'bedrockProgressBar',
    'bedrockStatusMessage',
    'bedrockDownloadLink',
    convertBedrockToJava
);
