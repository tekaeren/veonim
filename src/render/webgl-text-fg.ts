import { getColorAtlas } from '../render/highlight-attributes'
import generateFontAtlas from '../render/font-texture-atlas'
import { WebGL2, VarKind } from '../render/webgl-utils'
import * as cc from '../core/canvas-container'

export default (webgl: WebGL2) => {
  const size = { rows: 0, cols: 0 }

  const program = webgl.setupProgram({
    quadVertex: VarKind.Attribute,
    charIndex: VarKind.Attribute,
    cellPosition: VarKind.Attribute,
    hlid: VarKind.Attribute,
    canvasResolution: VarKind.Uniform,
    fontAtlasResolution: VarKind.Uniform,
    colorAtlasResolution: VarKind.Uniform,
    fontAtlasTextureId: VarKind.Uniform,
    colorAtlasTextureId: VarKind.Uniform,
    cellSize: VarKind.Uniform,
  })

  program.setVertexShader(v => `
    in vec2 ${v.quadVertex};
    in vec2 ${v.cellPosition};
    in float ${v.hlid};
    in float ${v.charIndex};
    uniform vec2 ${v.canvasResolution};
    uniform vec2 ${v.fontAtlasResolution};
    uniform vec2 ${v.colorAtlasResolution};
    uniform vec2 ${v.cellSize};

    out vec2 o_colorPosition;
    out vec2 o_glyphPosition;

    void main() {
      vec2 absolutePixelPosition = ${v.cellPosition} * ${v.cellSize};
      vec2 vertexPosition = absolutePixelPosition + ${v.quadVertex};
      vec2 posFloat = vertexPosition / ${v.canvasResolution};
      float posx = posFloat.x * 2.0 - 1.0;
      float posy = posFloat.y * -2.0 + 1.0;
      gl_Position = vec4(posx, posy, 0, 1);

      vec2 glyphPixelPosition = vec2(${v.charIndex}, 0) * ${v.cellSize};
      vec2 glyphVertex = glyphPixelPosition + ${v.quadVertex};
      o_glyphPosition = glyphVertex / ${v.fontAtlasResolution};

      o_colorPosition = vec2(${v.hlid}, 1) / ${v.colorAtlasResolution};
    }
  `)

  // TODO: move highlight color lookup to vertex shader?
  // the hl color will be the same for the current vertex.
  // as i understand it, fragment shaders will run multiple
  // times per vertex to interpolate pixel values. skipping
  // the hl color lookup might save a tiny bit of perf

  program.setFragmentShader(v => `
    precision highp float;

    in vec2 o_glyphPosition;
    in vec2 o_colorPosition;
    uniform sampler2D ${v.fontAtlasTextureId};
    uniform sampler2D ${v.colorAtlasTextureId};

    out vec4 outColor;

    void main() {
      vec4 glyphColor = texture(${v.fontAtlasTextureId}, o_glyphPosition);
      vec4 highlightColor = texture(${v.colorAtlasTextureId}, o_colorPosition);
      outColor = glyphColor * highlightColor;
    }
  `)

  program.create()
  program.use()

  const fontAtlas = generateFontAtlas()
  const fontAtlasWidth = Math.floor(fontAtlas.width / window.devicePixelRatio)
  const fontAtlasHeight = Math.floor(fontAtlas.height / window.devicePixelRatio)

  webgl.loadCanvasTexture(fontAtlas, webgl.gl.TEXTURE0)
  webgl.gl.uniform1i(program.vars.fontAtlasTextureId, 0)
  webgl.gl.uniform2f(program.vars.fontAtlasResolution, fontAtlasWidth, fontAtlasHeight)

  const colorAtlas = getColorAtlas()
  webgl.loadCanvasTexture(colorAtlas, webgl.gl.TEXTURE1)
  webgl.gl.uniform1i(program.vars.colorAtlasTextureId, 1)
  webgl.gl.uniform2f(program.vars.colorAtlasResolution, colorAtlas.width, colorAtlas.height)

  // total size of all pointers. chunk size that goes to shader
  const wrenderStride = 4 * Float32Array.BYTES_PER_ELEMENT

  const wrenderBuffer = program.setupData([{
    pointer: program.vars.cellPosition,
    type: webgl.gl.FLOAT,
    size: 2,
    offset: 0,
    stride: wrenderStride,
    divisor: 1,
  }, {
    pointer: program.vars.hlid,
    type: webgl.gl.FLOAT,
    size: 1,
    offset: 2 * Float32Array.BYTES_PER_ELEMENT,
    stride: wrenderStride,
    divisor: 1,
  }, {
    pointer: program.vars.charIndex,
    type: webgl.gl.FLOAT,
    size: 1,
    offset: 3 * Float32Array.BYTES_PER_ELEMENT,
    stride: wrenderStride,
    divisor: 1,
  }])

  const quadBuffer = program.setupData({
    pointer: program.vars.quadVertex,
    type: webgl.gl.FLOAT,
    size: 2,
  })

  quadBuffer.setData(new Float32Array([
    0, 0,
    cc.cell.width, cc.cell.height,
    0, cc.cell.height,
    cc.cell.width, 0,
    cc.cell.width, cc.cell.height,
    0, 0,
  ]))

  webgl.gl.uniform2f(program.vars.cellSize, cc.cell.width, cc.cell.height)

  const resize = (width: number, height: number) => {
    webgl.resize(width, height)
  }

  const oldResize = (rows: number, cols: number) => {
    if (size.rows === rows && size.cols === cols) return

    Object.assign(size, { rows, cols })
    const width = cols * cc.cell.width
    const height = rows * cc.cell.height

    webgl.gl.uniform2f(program.vars.canvasResolution, width, height)
  }

  const render = (buffer: Float32Array) => {
    wrenderBuffer.setData(buffer)
    webgl.gl.drawArraysInstanced(webgl.gl.TRIANGLES, 0, 6, buffer.length / 4)
  }

  const renderFromBuffer = (buffer: Float32Array) => {
    wrenderBuffer.setData(buffer)
    webgl.gl.drawArraysInstanced(webgl.gl.TRIANGLES, 0, 6, buffer.length / 4)
  }

  const updateFontAtlas = (fontAtlas: HTMLCanvasElement) => {
    webgl.loadCanvasTexture(fontAtlas, webgl.gl.TEXTURE0)
    const width = Math.floor(fontAtlas.width / window.devicePixelRatio)
    const height = Math.floor(fontAtlas.height / window.devicePixelRatio)
    webgl.gl.uniform2f(program.vars.fontAtlasResolution, width, height)
  }

  const updateColorAtlas = (colorAtlas: HTMLCanvasElement) => {
    webgl.loadCanvasTexture(colorAtlas, webgl.gl.TEXTURE1)
    webgl.gl.uniform2f(program.vars.colorAtlasResolution, colorAtlas.width, colorAtlas.height)
  }

  const clear = () => webgl.gl.clear(webgl.gl.COLOR_BUFFER_BIT)

  return { clear, render, renderFromBuffer, resize, updateFontAtlas, updateColorAtlas }
}
