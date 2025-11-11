# Configuration file for the Sphinx documentation builder.
#
# This file only contains a selection of the most common options. For a full
# list see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Path setup --------------------------------------------------------------

# If extensions (or modules to document with autodoc) are in another directory,
# add these directories to sys.path here. If the directory is relative to the
# documentation root, use os.path.abspath to make it absolute, like shown here.
#
# import os
# import sys
# sys.path.insert(0, os.path.abspath('.'))


# -- Project information -----------------------------------------------------

project = "cdk8s-mailu"
copyright = "2024-2025, Blue Dynamics Alliance"
author = "Blue Dynamics Alliance Contributors"

# The full version, including alpha/beta/rc tags
release = "0.0.0"


# -- General configuration ---------------------------------------------------

# Add any Sphinx extension module names here, as strings. They can be
# extensions coming with Sphinx (named 'sphinx.ext.*') or your custom
# ones.
extensions = [
    "myst_parser",
    "sphinxcontrib.mermaid",
    "sphinx_design",  # For grid and card directives
    "sphinx_copybutton",  # Add copy button to code blocks
]

# MySt specific extensions
myst_enable_extensions = [
    "deflist",  # You will be able to utilise definition lists
    "colon_fence",  # Allow ::: fences for directives (needed for grid, cards, etc.)
]

# Treat code fences with these languages as Sphinx directives
myst_fence_as_directive = ["mermaid"]

# Add any paths that contain templates here, relative to this directory.
templates_path = ["_templates"]

# List of patterns, relative to source directory, that match files and
# directories to ignore when looking for source files.
# This pattern also affects html_static_path and html_extra_path.
exclude_patterns = []

# mermaid options
mermaid_output_format = "raw"  # Use client-side rendering with mermaid.js
# -- Options for HTML output -------------------------------------------------

# Base URL for GitHub Pages deployment
# Set to "" for local development, or the full Pages URL for deployment
# This makes absolute paths in logo_target work correctly with path prefix
html_baseurl = "https://bluedynamics.github.io/cdk8s-mailu"

# The theme to use for HTML and HTML Help pages.  See the documentation for
# a list of builtin themes.
#
html_theme = "shibuya"

html_theme_options = {
    # Logo configuration - absolute path resolves relative to html_baseurl
    "logo_target": "/",

    # Color scheme - using cyan from brand palette (#00d4ff)
    "accent_color": "cyan",

    # Color mode - force dark mode (brand is dark-first cyberpunk aesthetic)
    "color_mode": "dark",

    # Dark code blocks
    "dark_code": True,

    # Navigation
    "nav_links": [],
}

# Logo configuration (Shibuya uses different approach)
html_logo = "_static/mailu-logo.svg"

# Add any paths that contain custom static files (such as style sheets) here,
# relative to this directory. They are copied after the builtin static files,
# so a file named "default.css" will overwrite the builtin "default.css".
html_static_path = ["_static"]

# Custom CSS files
html_css_files = [
    "brand-theme.css",  # Main brand theme (includes fonts, colors, cyberpunk design, icons)
]

# Custom JavaScript files
html_js_files = [
    "logo-fix.js",  # Fix logo link for path prefix deployment
]
