import * as d3 from 'd3';
import * as d3Tip from 'd3-tip';
import { handleErrors } from '../common/utils';
import {
  Cell,
  Link,
  Looker,
  LookerChartUtils, VisConfig, VisData, VisQueryResponse,
  VisualizationDefinition, VisUpdateDetails
} from '../types/types';
import {ScaleBand, scaleBand, ScaleLinear, scaleLinear} from 'd3-scale';
import {extent} from 'd3-array';
import {select} from 'd3-selection';

// Global values provided via the API
declare const looker: Looker;
declare const LookerCharts: LookerChartUtils;

interface DoubleBar extends VisualizationDefinition {
  svg?: any;
  tooltip?: any;
  svgRows?: any;
  width?: number; // Width of the element
  height?: number; // Height of the element

  /**
   * The y position scale used for the rows.
   * - Based on the svg height.
   * - Based on the number of rows
   */
  rowYPosition: ScaleBand<number>;

  /**
   * The width scale used for the left bars.
   * - The domain is based on {@link leftValueSelector}
   * - - Affected by {@link independentDomainMax}
   * - The range is based on {@link halfGraphWidth}
   */
  leftBarWidth: ScaleLinear<number, number>;

  /**
   * The width scale used for the right bars.
   * - The domain is based on {@link rightValueSelector}
   * - - Affected by {@link independentDomainMax}
   * - The range is based on {@link halfGraphWidth}
   */
  rightBarWidth: ScaleLinear<number, number>;

  /**
   * Represents the largest width of all displayed bar values texts.
   */
  maxBarLabelWidth?: number;

  /**
   * The width available to the two bar-graphs and their respective value text
   */
  graphWidth: number;

  /**
   * The space available to the legend text
   */
  legendWidth: number;

  /**
   * Factors in the X-position modifier for the legend text
   */
  legendTextWidth: number;

  halfGraphWidth: number;

  /**
   * Space available to a single side's bars
   * @returns {number}
   */
  halfGraphBarMaxWidth: number;

  /**
   * Factors in the X-position modifier for the title text
   */
  titleTextWidth: number;

  rowHeight: number;

  barHeight: number;

  /**
   * Thickness of the bar as a ratio of its available space, so it should be a value between 0 and 1
   */
  barSizeRatio: number;

  rowHighlightThickness: number;

  /**
   * The space from the top of a row to the top of the bar within that row
   */
  barMargin: number;

  /**
   * The x position where the two bars (left and right) meet
   */
  barOriginX: number;
}

function rowTooltipSelector(item: any): string {
  const ratio = item.right > 0 ? item.left / item.right : 0;
  return `<span>Ratio: ${(ratio * 100).toFixed(0)}%</span>`;
}

interface DoubleBarRow {
  name: string;
  left: number;
  right: number;
}

interface DoubleBarData {
  rows: DoubleBarRow[];
  leftTitle: string;
  rightTitle: string;
}

const style = `
<style>
  .d3-tooltip {
    background: #000d;
    color: white;
    padding: 3px;
    border-radius: 4px;
  }
  g.chart-row {
    cursor: pointer;
  }

  g.chart-row:hover {
    fill: #888;
  }

  g.chart-row:active {
    fill: #aaa;
  }
</style>
`;

/**
 * Creates a sequential array of the indicated size.
 */
export function sequence(size: number): number[] {
  return Array.from(Array(size), (_: any, i: number) => i);
}

function rowNameSelector(row: DoubleBarRow): string {
  return row.name;
}

function rowLeftSelector(row: DoubleBarRow): number {
  return row.left;
}

function rowRightSelector(row: DoubleBarRow): number {
  return row.right;
}

export function truncateText(width: number) {
  return (_: any, index: number, array: any[]) => {
    const el = array[index];
    const self = select(el);
    let textLength = el.getComputedTextLength();
    let text = self.text();
    while (textLength > width && text.length > 0) {
      text = text.slice(0, -1);
      self.text(text + '…');
      textLength = el.getComputedTextLength();
    }
  };
}

function validateInputs(this: VisualizationDefinition, queryResponse: VisQueryResponse) {
  return handleErrors(this, queryResponse, {
    min_pivots: 0,
    max_pivots: 0,
    min_dimensions: 1,
    max_dimensions: 1,
    min_measures: 2,
    max_measures: 2
  });
}

/**
 * Generates the text elements for all left and right bar values,
 * then determines which one has the biggest display width and stores that value for later use.
 *
 * Deletes these elements immediately after they've served their purpose
 */
function determineMaxBarValueWidth(this: DoubleBar, rowData: DoubleBarRow[]) {
  this.maxBarLabelWidth = 0;

  this.svg
    .selectAll('text.dummy-left')
    .data(rowData)
    .enter()
    .append('text')
    .attr('class', 'dummy-left')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 12)
    .text(rowLeftSelector)
    .each((_: any, index: number, array: any[]) => {
      this.maxBarLabelWidth = Math.max(this.maxBarLabelWidth, array[index].getComputedTextLength());
    })
    .remove();

  this.svg
    .selectAll('text.dummy-right')
    .data(rowData)
    .enter()
    .append('text')
    .attr('class', 'dummy-right')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 12)
    .text(rowRightSelector)
    .each((_: any, index: number, array: any[]) => {
      this.maxBarLabelWidth = Math.max(this.maxBarLabelWidth, array[index].getComputedTextLength());
    })
    .remove();
}

function setupInputs(this: DoubleBar, doubleBarData: DoubleBarData) {

  this.tooltip = d3Tip()
    .attr('class', 'd3-tooltip')
    .html(rowTooltipSelector);

  const [, leftMax] = extent(doubleBarData.rows, rowLeftSelector);
  const [, rightMax] = extent(doubleBarData.rows, rowRightSelector);

  const maxOfBoth = Math.max(leftMax, rightMax);
  this.leftBarWidth.domain([0, maxOfBoth]);
  this.rightBarWidth.domain([0, maxOfBoth]);

  this.rowYPosition
    .paddingInner(.7)
    .paddingOuter(this.rowYPosition.paddingInner() / 2)
    .domain(sequence(doubleBarData.rows.length));

}

function setupRender(this: DoubleBar, doubleBarData: DoubleBarData, config: VisConfig) {
  this.svg.call(this.tooltip);

  if (this.svgRows) {
    console.log(this.svgRows);
    this.svgRows.remove();
  }

  this.svgRows = this.svg
    .selectAll('g.chart-row')
    .data(doubleBarData.rows)
    .enter()
    .append('g')
    .attr('class', 'chart-row')
    .attr('fill', 'rgba(255, 255, 255, 0)');

  this.svgRows
    .on('mouseover', (data, index, array) => {
      const targetSelf = array[index];
      this.tooltip.show(data, targetSelf);
    })
    .on('mouseout', data => {
      this.tooltip.hide(data);
    });

  this.svgRows
    .append('rect')
    .attr('x', 0)
    .attr('rx', 5)
    .attr('ry', 5)
    .attr('fill-opacity', 0.5)
    .attr('class', 'row-highlight');

  this.svgRows
    .append('text')
    .attr('dy', '.35em')
    .attr('fill', '#000')
    .attr('class', 'legend-text')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 11);

  this.svgRows
    .append('text')
    .attr('dy', '.35em')
    .attr('text-anchor', 'end')
    .attr('class', 'left-value')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 12)
    .attr('fill', '#888888')
    .text(rowLeftSelector);

  this.svgRows
    .append('text')
    .attr('dy', '.35em')
    .attr('class', 'right-value')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 12)
    .attr('fill', '#888888')
    .text(rowRightSelector);

  this.svgRows
    .append('rect')
    .attr('class', 'left-bar')
    .attr('fill', (config && config.leftColor) || this.options.leftColor.default);

  this.svgRows
    .append('rect')
    .attr('class', 'right-bar')
    .attr('fill', (config && config.rightColor) || this.options.rightColor.default);

  this.svg
    .append('text')
    .attr('y', 0)
    .attr('dy', '.7em')
    .attr('text-anchor', 'end')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 11)
    .attr('fill', '#888888')
    .attr('class', 'left-title title');

  this.svg
    .append('text')
    .attr('y', 0)
    .attr('dy', '.7em')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 11)
    .attr('fill', '#888888')
    .attr('class', 'right-title title');
}

function setupSizing(this: DoubleBar, doubleBarData: DoubleBarData) {

  this.tooltip.offset([0, -this.width / 2 + this.barOriginX]);

  // Update our scales
  this.rowYPosition.range([15, this.height]);
  this.leftBarWidth.range([1, this.halfGraphBarMaxWidth]);
  this.rightBarWidth.range([1, this.halfGraphBarMaxWidth]);

  this.svgRows.attr('transform', (data: any, index: number) => {
    return `translate(0, ${this.rowYPosition(index)})`;
  });

  this.svgRows
    .selectAll('rect.row-highlight')
    .attr('width', this.width)
    .attr('height', this.rowHighlightThickness)
    .attr('y', (this.rowHeight - this.rowHighlightThickness) / 2);

  this.svgRows
    .selectAll('text.legend-text')
    .attr('x', 8)
    .attr('y', this.rowHeight / 2)
    .text(rowNameSelector)
    .each(truncateText(this.legendTextWidth));

  this.svgRows
    .selectAll('text.left-value')
    .attr('x', (item: any) => {
      return (
        this.barOriginX -
        this.leftBarWidth(rowLeftSelector(item)) -
        5
      );
    })
    .attr('y', this.rowHeight / 2);

  this.svgRows
    .selectAll('text.right-value')
    .attr('x', (item: any) => {
      return (
        this.barOriginX +
        this.rightBarWidth(rowRightSelector(item)) +
        5
      );
    })
    .attr('y', this.rowHeight / 2);

  this.svgRows
    .selectAll('rect.left-bar')
    .attr('x', (item: any) => {
      return this.barOriginX - this.leftBarWidth(rowLeftSelector(item));
    })
    .attr('y', this.barMargin)
    .attr('width', (item: any) => {
      return this.leftBarWidth(rowLeftSelector(item));
    })
    .attr('height', this.barHeight);

  this.svgRows
    .selectAll('rect.right-bar')
    .attr('x', this.barOriginX)
    .attr('y', this.barMargin)
    .attr('width', (item: any) => {
      return this.rightBarWidth(rowRightSelector(item));
    })
    .attr('height', this.barHeight);

  this.svg
    .select('text.left-title')
    .attr('x', this.barOriginX - 10)
    .text(doubleBarData.leftTitle)
    .each(truncateText(this.titleTextWidth));

  this.svg
    .select('text.right-title')
    .attr('x', this.barOriginX + 10)
    .text(doubleBarData.rightTitle)
    .each(truncateText(this.titleTextWidth));
}

function createChartData(data: VisData, config: VisConfig): DoubleBarData {
  const dimensionName = config.query_fields.dimensions[0].name;
  const leftMeasureName = config.query_fields.measures[0].name;
  const rightMeasureName = config.query_fields.measures[1].name;

  return {
    leftTitle: config.query_fields.measures[0].label,
    rightTitle: config.query_fields.measures[1].label,
    rows: data.map((row: any) => {
      return {
        name: row[dimensionName].value,
        left: row[leftMeasureName].value,
        right: row[rightMeasureName].value
      } as DoubleBarRow;
    })
  } as DoubleBarData;
}

// Initial Setup
function create(this: DoubleBar, element: HTMLElement, settings: VisConfig): void {
  element.innerHTML = style;

  this.svg = d3.select(element).append('svg');
}

function updateAsync(this: DoubleBar,
                     data: VisData,
                     element: HTMLElement,
                     config: VisConfig,
                     queryResponse: VisQueryResponse,
                     details: VisUpdateDetails | undefined,
                     doneRendering: () => void) {
  if (!validateInputs.call(this, queryResponse)) {
    return;
  }

  this.width = element.clientWidth;
  this.height = element.clientHeight;

  this.svg
    .attr('width', this.width)
    .attr('height', this.height);

  const chartData = createChartData.call(this, data, config);

  setupInputs.call(this, chartData);

  determineMaxBarValueWidth.call(this, chartData.rows);

  setupRender.call(this, chartData, config);

  setupSizing.call(this, chartData);

  doneRendering();
}

const vis: DoubleBar = {
  id: 'doubleBar',
  label: 'Double Bar',
  options: {
    leftColor: {
      label: 'Left Bars Color',
      default: '#FEC500',
      type: 'string',
      display: 'color'
    },
    rightColor: {
      label: 'Right Bars Color',
      default: '#42B3D5',
      type: 'string',
      display: 'color'
    }
  },
  rowYPosition: scaleBand<number>().align(0),
  leftBarWidth: scaleLinear(),
  rightBarWidth: scaleLinear(),
  create,
  // Render in response to the data or settings changing
  updateAsync,

  // Getters
  /**
   * The width available to the two bar-graphs and their respective value text
   */
  get graphWidth(): number {
    return this.width * .65;
  },

  get legendWidth(): number {
    return this.width - (this.graphWidth + 10);
  },

  get legendTextWidth(): number {
    return this.legendWidth - 8;
  },

  get halfGraphWidth() {
    return this.graphWidth / 2;
  },

  /**
   * Space available to a single side's bars
   * @returns {number}
   */
  get halfGraphBarMaxWidth(): number {
    return this.halfGraphWidth - (this.maxBarLabelWidth + 10);
  },

  /**
   * Factors in the X-position modifier for the title text
   */
  get titleTextWidth(): number {
    return this.halfGraphWidth - 10;
  },

  get rowHeight(): number {
    return this.rowYPosition.step();
  },

  get barHeight(): number {
    return this.rowYPosition.bandwidth();
  },

  /**
   * Thickness of the bar as a ratio of its available space, so it should be a value between 0 and 1
   */
  get barSizeRatio(): number {
    return this.rowHeight / (this.rowHeight * 3);
  },

  get rowHighlightThickness(): number {
    return this.rowHeight;
  },

  /**
   * The space from the top of a row to the top of the bar within that row
   */
  get barMargin(): number {
    return (this.rowHeight - this.barHeight) / 2;
  },

  /**
   * The x position where the two bars (left and right) meet
   */
  get barOriginX(): number {
    return this.width - this.halfGraphWidth;
  }
};

looker.plugins.visualizations.add(vis);
