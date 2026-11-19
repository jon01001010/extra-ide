; space.tact: 3d points to 2d lines. side loaded: (use "lib/space.tact"). tact --sigs lib/space.tact lists it.
(use draw)
(rec Cam [w Num h Num zoom Num back Num])

; turn [x y z] by a around the y axis, then by b around the x axis
(fn spin [v (Vec Num) a Num b Num] (Vec Num)
  (with [x (get v 0)  y (get v 1)  z (get v 2)
         x1 (- (* x (cos a)) (* z (sin a)))   z1 (+ (* x (sin a)) (* z (cos a)))]
    [x1 (- (* y (cos b)) (* z1 (sin b))) (+ (* y (sin b)) (* z1 (cos b)))]))

; perspective: [x y z] to screen [x y]. needs z > -back
(fn project [c Cam v (Vec Num)] (Vec Num)
  (with [k (/ (Cam.zoom c) (+ (Cam.back c) (get v 2)))]
    [(+ (/ (Cam.w c) 2) (* k (get v 0))) (+ (/ (Cam.h c) 2) (* k (get v 1)))]))

; one Line per edge. an edge is [i j], two places in pts
(fn wire [c Cam pts (Vec (Vec Num)) edges (Vec (Vec Num)) color Str] (Vec Draw)
  (with [ps (map (fun [v] (project c v)) pts)]
    (for [e edges]
      (with [p (get ps (get e 0))  q (get ps (get e 1))]
        (Line (get p 0) (get p 1) (get q 0) (get q 1) color)))))

(let cube-pts (for [x [-1 1] y [-1 1] z [-1 1]] [x y z]))
(let cube-edges (for [p (pairs 0 8)]
                  (= 1 (vsum (map2 (fun [a b] (if (= a b) 0 1)) (get cube-pts (get p 0)) (get cube-pts (get p 1)))))
                  p))

(check (spin [1 0 0] 0 0) [1 0 0])
(check (project (Cam 100 100 50 5) [0 0 0]) [50 50])
(check (len cube-edges) 12)
