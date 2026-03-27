(function () {
    const navItems = [
        { key: "home", href: "./index.html", label: "Home" },
        { key: "capture", href: "./capture.html", label: "Capture" },
        { key: "processing", href: "./processing.html", label: "Processing" },
        { key: "storage", href: "./graph.html", label: "Storage" }
    ];

    function renderSharedNav() {
        const mountPoint = document.getElementById("shared-nav");
        if (!mountPoint) return;

        const activePage = document.body.dataset.page || "";
        const links = navItems
            .map((item) => {
                const activeClass = item.key === activePage ? " class=\"active\"" : "";
                return "<li><a href=\"" + item.href + "\"" + activeClass + ">" + item.label + "</a></li>";
            })
            .join("");

        mountPoint.innerHTML =
            "<nav class=\"site-nav\"><ul>" +
            links +
            "</ul></nav>";
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", renderSharedNav);
    } else {
        renderSharedNav();
    }
})();
