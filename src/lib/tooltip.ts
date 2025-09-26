const SVG_NS = 'http://www.w3.org/2000/svg';

export interface TooltipHandle {
  element: SVGForeignObjectElement;
  body: HTMLDivElement;
  show: (x: number, y: number, html: string) => void;
  hide: () => void;
}

export const createTooltip = (svg: SVGSVGElement): TooltipHandle => {
  const fo = document.createElementNS(SVG_NS, 'foreignObject');
  fo.setAttribute('width', '200');
  fo.setAttribute('height', '120');
  fo.style.pointerEvents = 'none';
  fo.style.opacity = '0';

  const div = document.createElement('div');
  div.className = 'tooltip';

  fo.appendChild(div);
  svg.appendChild(fo);

  return {
    element: fo,
    body: div,
    show(x, y, html) {
      fo.setAttribute('x', `${x}`);
      fo.setAttribute('y', `${y}`);
      div.innerHTML = html;
      fo.style.opacity = '1';
    },
    hide() {
      fo.style.opacity = '0';
    },
  };
};
