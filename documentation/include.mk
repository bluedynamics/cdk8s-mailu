# Custom Makefile includes
# This file is included by the generated Makefile and can be used to override targets

# Override docs-live to use port 8001 instead of default 8000
.PHONY: docs-live
docs-live: $(DOCS_TARGET) $(DOCS_TARGETS)
	@echo "Rebuild Sphinx documentation on changes, with live-reload in the browser (port 8001)"
	@$(SPHINX_AUTOBUILD_BIN) --port 8001 $(DOCS_SOURCE_FOLDER) $(DOCS_TARGET_FOLDER)
