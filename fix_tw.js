const fs = require('fs');
const path = require('path');

const newConfig = `tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              maroon: "#800000",
              gold: "#DAA520",
              pup: { maroon: "#800000", gold: "#DAA520", light: "#ffb3b2", dark: "#560000" },
              surface: { 
                DEFAULT: 'var(--md-sys-color-surface)', 
                container: 'var(--md-sys-color-surface-container)', 
                highest: 'var(--md-sys-color-surface-container-highest)',
                high: 'var(--md-sys-color-surface-container-high)',
                low: 'var(--md-sys-color-surface-container-low)'
              },
              primary: { DEFAULT: 'var(--md-sys-color-primary)', on: 'var(--md-sys-color-on-primary)', container: 'var(--md-sys-color-primary-container)' },
              secondary: { DEFAULT: 'var(--md-sys-color-secondary)', on: 'var(--md-sys-color-on-secondary)', container: 'var(--md-sys-color-secondary-container)' },
              tertiary: { DEFAULT: 'var(--md-sys-color-tertiary)', on: 'var(--md-sys-color-on-tertiary)', container: 'var(--md-sys-color-tertiary-container)' },
            },
            borderRadius: {
              'xl': '1rem',
              '2xl': '1.5rem',
              '3xl': '1.75rem',
              '4xl': '2rem',
            },
            boxShadow: {
              'soft': '0 4px 20px rgba(0, 0, 0, 0.05)',
              'float': '0 8px 30px rgba(0, 0, 0, 0.08)',
              'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
            }
          },
        },
      };`

function processDir(dir) {
    fs.readdirSync(dir).forEach(file => {
        let fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.html')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let updated = content.replace(/tailwind\.config\s*=\s*\{[\s\S]*?(?=<\/script>)/, newConfig + '\n    ');
            if (updated !== content) {
                fs.writeFileSync(fullPath, updated);
                console.log('Updated ' + fullPath);
            }
        }
    });
}

processDir('frontend');
