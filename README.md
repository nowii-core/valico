# Valico

**A lightweight 3D interactive web experience and browser application.**

Valico is a web-based 3D application built with vanilla HTML, CSS, JavaScript, and WebGL2. It features custom WebGL shaders, procedural environment and world generation, modular audio feedback, and full support for both desktop and mobile devices.

The project is designed as a lightweight, zero-dependency browser experience, requiring no external frameworks or build systems.

[Overview](#overview) · [Features](#features) · [Live Demo](#live-demo) · [Tech Stack](#tech-stack) · [Quick Start](#quick-start) · [Project Structure](#project-structure) · [Rendering & Architecture](#rendering--architecture) · [Development](#development) · [Compatibility](#compatibility) · [License](#license) · [Contact](#contact)

## Overview

**Valico** is a browser-based 3D application designed to deliver smooth interactive performance directly in the web browser.

Users can navigate through an interactive 3D world rendered via custom WebGL2 shaders. The application features built-in state management, input handling, audio generation, and responsive user interface overlays.

The project relies on native browser APIs, including custom WebGL2 rendering pipelines, procedural audio via the Web Audio API, and zero npm packages or build pipelines.

## Features

* **3D Interactive Environment** — High-performance 3D visual rendering powered by WebGL2.
* **Custom Shader Engine** — Procedural shaders written in GLSL for lighting, materials, and visual effects.
* **Modular JavaScript Architecture** — Separated logic for game states, world management, utility helpers, and audio.
* **Web Audio Sound System** — Dynamic audio generated directly in the browser via Web Audio API.
* **Responsive User Interface** — Custom layout overlay built with CSS3 and HTML5.
* **Desktop and Mobile Support** — Built-in support for both mouse/keyboard input and touch controls.
* **Zero Dependencies** — Built using pure native web technologies without external libraries or frameworks.

## Live Demo

**Live Demo:** https://nowii-core.github.io/valico/valico/

## Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **HTML5** | Page structure, UI layout, canvas container |
| **CSS3** | Interface styling, responsive overlays, menu layouts |
| **JavaScript (ES6+)** | Core engine logic, input handling, state management, world updates |
| **WebGL2 / GLSL** | Custom 3D rendering pipeline, shaders, vertex and fragment processing |
| **Web Audio API** | Dynamic procedural audio effects and sound synthesis |

**Dependencies:** None.

**Build tools:** None required.

**Rendering requirement:** WebGL2 support is required.

## Quick Start

### Requirements

* A modern web browser with WebGL2 support.
* Keyboard and mouse for desktop navigation, or a touchscreen for mobile interaction.
* A local web server for the recommended development setup.

### Run Locally

1. **Clone the repository:**

   ```bash
   git clone https://github.com/nowii-core/valico.git
   ```

2. **Open the project subdirectory:**

   ```bash
   cd valico/valico
   ```

3. **Start a local web server:**

   ```bash
   python3 -m http.server 8000
   ```

4. **Open the application in your browser:**

   ```text
   http://localhost:8000
   ```

You can also open `index.html` directly in a browser. Using a local server is recommended during development.

No package installation, compilation, or build process is needed.

## Project Structure

The project code is located inside the `valico/` subdirectory:

```text
valico/                          # GitHub repository root
└── valico/                      # Application subdirectory
    ├── index.html               # Main entry point and canvas setup
    ├── css/
    │   └── style.css            # Layout and user interface styles
    ├── js/
    │   ├── game.js              # Main application entry and engine loop
    │   ├── play.js              # Scene states and interaction logic
    │   ├── world.js             # World generation and spatial entities
    │   ├── shaders.js           # GLSL WebGL shader sources
    │   ├── audio.js             # Web Audio sound engine
    │   └── util.js              # Mathematical and helper utilities
    ├── LICENSE                  # MIT License
    └── README.md                # Project documentation
```

## Rendering & Architecture

Valico uses a modular JavaScript structure alongside custom WebGL2 context management:

* **Shaders (`js/shaders.js`):** Custom vertex and fragment shaders compile at runtime for lighting and geometry rendering.
* **World Engine (`js/world.js`):** Handles object coordinates, spatial hierarchy, and dynamic environment updates.
* **Audio Engine (`js/audio.js`):** Uses Web Audio API nodes to synthesize audio effects without external media assets.
* **Game Loop (`js/game.js` & `js/play.js`):** Manages the requestAnimationFrame loop, input state updates, and rendering passes.

## Development

The project is structured into standalone modular ES JavaScript files, making it simple to extend without needing bundlers like Webpack or Vite.

### Recommended Workflow

1. Clone the repository.
2. Open the `valico/` subdirectory in your editor.
3. Launch a local web server.
4. Edit HTML, CSS, or JS files directly.
5. Reload the browser to test changes.

### Customization

* **UI & Style:** Edit `css/style.css` to adjust overlay layout and styles.
* **Shaders & Graphics:** Edit `js/shaders.js` to modify GLSL code for visual effects.
* **Audio:** Edit `js/audio.js` to tweak synthesized sounds and pitch curves.
* **World Logic:** Modify `js/world.js` and `js/play.js` for custom entities and interactive logic.

## Compatibility

Valico requires a browser with **WebGL2** support. It is optimized for modern desktop and mobile browsers including Chrome, Firefox, Safari, and Edge.

## License

This project is distributed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

## Contact

* **Developer:** [@nowii-core](https://github.com/nowii-core)
* **Repository:** [nowii-core/valico](https://github.com/nowii-core/valico)
* **Issues & Suggestions:** [Open an issue](https://github.com/nowii-core/valico/issues)

---

<p align="center">
  <sub>Designed and developed by <a href="https://github.com/nowii-core"><b>nowii-core</b></a></sub>
</p>
