window.initFuturisticLogin = function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return () => {};

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9'; // Strictly above image (z-index 0) and vignette (z-index 1), below UI (z-index 10)
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: true });
    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const particles = [];
    const particleCount = 200; // Multi-layered depth needs slightly higher count

    // Cinematic depth-layered Magical Aura - Increased visibility
    for (let i = 0; i < particleCount; i++) {
        const depth = Math.random(); // 0 (deep background) to 1 (close foreground)
        particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: (Math.random() * 2.5 + 0.8) * (depth * 1.5 + 0.5), // Larger for visibility
            vx: (Math.random() - 0.5) * 0.15 * (depth + 0.5),
            vy: (Math.random() * -0.2 - 0.1) * (depth + 0.5), 
            alphaBase: Math.random() * 0.4 + 0.15, // Higher base opacity
            pulseSpeed: Math.random() * 0.008 + 0.003,
            depth: depth,
            color: Math.random() > 0.6 ? '139, 92, 246' : (Math.random() > 0.3 ? '14, 165, 233' : '99, 102, 241')
        });
    }

    const logoO = document.querySelector('.logo-o');
    let lightningBolts = [];
    let environmentFlash = 0;
    
    // Realistic, instantly striking jagged thunderbolt
    function generateSkyLightning(startX, startY, baseAngle, length, thickness, isMain = true) {
        let x = startX;
        let y = startY;
        let currentAngle = baseAngle;
        
        const nodes = [{x, y}];
        let segments = Math.floor(Math.random() * 6 + (isMain ? 6 : 3)); 
        
        for(let i=0; i<segments; i++) {
            currentAngle += (Math.random() - 0.5) * 1.8; // Sharp jagged turns
            let step = (length / segments) * (Math.random() * 0.5 + 0.75);
            x += Math.cos(currentAngle) * step;
            y += Math.sin(currentAngle) * step;
            nodes.push({x, y});
        }
        
        lightningBolts.push({
            nodes: nodes,
            thickness: thickness,
            alpha: 1.5, // Overbright for instant flash
            color: Math.random() > 0.5 ? '14, 165, 233' : '139, 92, 246' // Electric blue vs Plasma purple
        });
        
        if (thickness > 0.8) {
            for(let i=1; i<nodes.length-1; i++) {
                if (Math.random() > 0.5) {
                    const branchAngle = currentAngle + (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 0.8 + 0.4);
                    generateSkyLightning(nodes[i].x, nodes[i].y, branchAngle, length * 0.5, thickness * 0.5, false);
                }
            }
        }
    }

    // Trigger subtle cinematic camera shake
    function triggerCinematicShake() {
        const uiLayer = document.querySelector('.ui-layer');
        if (uiLayer && window.gsap) {
            gsap.fromTo(uiLayer, 
                { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4 },
                { x: 0, y: 0, duration: 0.3, ease: "elastic.out(1, 0.3)", clearProps: "all" }
            );
        }
    }

    let animationId;
    let time = 0;
    let lightningTimer = 0;

    function animate() {
        ctx.clearRect(0, 0, width, height);
        time += 0.02;
        lightningTimer++;

        if (environmentFlash > 0) environmentFlash -= 0.05;

        // 1. Draw central knight volumetric bloom (deep navy + lightning flash)
        const centerGrad = ctx.createRadialGradient(
            width * 0.5, height * 0.5, 0, 
            width * 0.5, height * 0.5, Math.min(width, height) * 0.65
        );
        const baseAlpha = 0.06;
        const flashAlpha = Math.max(0, environmentFlash * 0.15); 
        
        centerGrad.addColorStop(0, `rgba(14, 165, 233, ${baseAlpha + flashAlpha})`);
        centerGrad.addColorStop(0.4, `rgba(30, 58, 138, ${0.03 + flashAlpha * 0.5})`);
        centerGrad.addColorStop(1, 'rgba(2, 3, 10, 0)');
        ctx.fillStyle = centerGrad;
        ctx.fillRect(0, 0, width, height);

        // 2. Draw cinematic multi-layered magical floating aura
        for (let i = 0; i < particleCount; i++) {
            const p = particles[i];
            
            // Subtle, floaty movement based on depth
            p.x += p.vx;
            p.y += p.vy;
            p.x += Math.sin(time * p.pulseSpeed * 10) * 0.1 * (p.depth + 0.5); 

            // Screen wrap
            if (p.y < -10) p.y = height + 10;
            if (p.x < -10) p.x = width + 10;
            if (p.x > width + 10) p.x = -10;

            // Natural fade-in and fade-out pulse
            const pulse = Math.sin(time * p.pulseSpeed * 25); 
            const currentAlpha = p.alphaBase + (pulse * p.alphaBase * 0.6);
            const finalAlpha = Math.max(0, Math.min(0.85, currentAlpha)); // Noticeably visible now
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${p.color}, ${finalAlpha})`;
            
            // Depth-based bloom and cinematic blur
            const blurAmount = (p.depth * 12 + 6) + (environmentFlash > 0.5 ? 15 : 0);
            ctx.shadowBlur = blurAmount;
            ctx.shadowColor = `rgba(${p.color}, ${finalAlpha + environmentFlash * 0.5})`;
            ctx.fill();
        }
        
        // 3. Realistic Sky Lightning from the "O" Reactor
        if (logoO) {
            const rect = logoO.getBoundingClientRect();
            const ox = rect.left + rect.width / 2;
            const oy = rect.top + rect.height / 2;
            const r = rect.width / 2 + 10; 

            const oGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * (4 + environmentFlash * 2));
            oGrad.addColorStop(0, `rgba(14, 165, 233, ${0.15 + environmentFlash * 0.2})`);
            oGrad.addColorStop(1, 'rgba(14, 165, 233, 0)');
            ctx.fillStyle = oGrad;
            ctx.beginPath();
            ctx.arc(ox, oy, r * 6, 0, Math.PI * 2);
            ctx.fill();

            // Generate small plasma arcs strictly localized around the O reactor
            if (lightningTimer > (Math.random() * 40 + 20)) {
                lightningTimer = 0;
                const angle = Math.random() * Math.PI * 2;
                // Start slightly inside/on the ring
                const startX = ox + Math.cos(angle) * (r - 5);
                const startY = oy + Math.sin(angle) * (r - 5);
                // Curve along or inward toward the core
                const inwardAngle = angle + Math.PI + (Math.random() - 0.5) * 1.2;
                
                // Short, highly localized plasma arcs (15px to 25px max length)
                generateSkyLightning(startX, startY, inwardAngle, Math.random() * 15 + 10, 1.8, true);
                
                // Local reactor glow pulse only, no fullscreen flashes/shakes
                environmentFlash = 0.3;
            }

            for (let i = lightningBolts.length - 1; i >= 0; i--) {
                const bolt = lightningBolts[i];
                
                ctx.beginPath();
                ctx.moveTo(bolt.nodes[0].x, bolt.nodes[0].y);
                for(let j=1; j<bolt.nodes.length; j++) {
                    ctx.lineTo(bolt.nodes[j].x, bolt.nodes[j].y);
                }
                
                ctx.lineWidth = bolt.thickness;
                const currentAlpha = Math.min(1.0, bolt.alpha);
                ctx.strokeStyle = `rgba(${bolt.color}, ${currentAlpha})`;
                
                ctx.shadowBlur = 25;
                ctx.shadowColor = `rgba(${bolt.color}, 1)`;
                ctx.stroke();
                
                if (bolt.thickness > 1.5) {
                    ctx.lineWidth = bolt.thickness * 0.4;
                    ctx.strokeStyle = `rgba(255, 255, 255, ${currentAlpha})`;
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = '#ffffff';
                    ctx.stroke();
                }

                bolt.alpha -= 0.15;
                if (bolt.alpha <= 0) {
                    lightningBolts.splice(i, 1);
                }
            }
        }
        
        ctx.shadowBlur = 0;
        animationId = requestAnimationFrame(animate);
    }
    animate();

    const card = document.getElementById('login-card');
    const brand = document.querySelector('.brand-section');
    const handleMouseMove = (e) => {
        if(!card || !brand) return;
        const xAxis = (window.innerWidth / 2 - e.pageX) / 160;
        const yAxis = (window.innerHeight / 2 - e.pageY) / 160;
        
        if (window.gsap) {
            gsap.to(card, { rotationY: -xAxis, rotationX: yAxis, duration: 2.5, ease: "power2.out" });
            gsap.to(brand, { x: xAxis * 1.2, y: yAxis * 1.2, duration: 2.5, ease: "power2.out" });
        }
    };
    document.addEventListener('mousemove', handleMouseMove);

    const handleResize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
    };
    window.addEventListener('resize', handleResize);

    return function cleanup() {
        cancelAnimationFrame(animationId);
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('mousemove', handleMouseMove);
        container.innerHTML = ''; 
    };
};
