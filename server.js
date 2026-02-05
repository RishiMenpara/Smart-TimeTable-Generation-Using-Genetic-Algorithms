const express = require('express');
const cors = require('cors');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const GeneticAlgorithm = require('./ga');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Create output directory if doesn't exist
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * POST /api/generate-timetable
 * Main endpoint to generate timetable using GA
 */
app.post('/api/generate-timetable', async (req, res) => {
  try {
    const {
      standards,
      faculty,
      assignments,
      classrooms,
      daysOfWeek,
      timeSlots
    } = req.body;

    console.log('Received request to generate timetable');
    console.log('Assignments:', assignments.length);

    // Validate input
    const validation = validateInput({
      standards,
      faculty,
      assignments,
      classrooms,
      daysOfWeek,
      timeSlots
    });

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(', ')
      });
    }

    // Check if solution is possible
    const feasibilityCheck = checkFeasibility({
      assignments,
      classrooms,
      daysOfWeek,
      timeSlots
    });

    if (!feasibilityCheck.isPossible) {
      return res.status(400).json({
        success: false,
        error: feasibilityCheck.reason
      });
    }

    // Run GA
    const ga = new GeneticAlgorithm({
      standards,
      faculty,
      assignments,
      classrooms,
      daysOfWeek,
      timeSlots
    });

    const solution = ga.run();

    // Format solution for space-time table
    const formattedData = formatSolution(solution, {
      standards,
      faculty,
      assignments,
      classrooms,
      daysOfWeek,
      timeSlots
    });

    // Generate Excel file
    const filename = `timetable_${Date.now()}.xlsx`;
    const filepath = path.join(outputDir, filename);
    
    await createExcelTimetable(formattedData, filepath);

    res.json({
      success: true,
      filename: filename,
      filepath: `/output/${filename}`,
      stats: {
        conflicts: solution.conflicts,
        fitness: solution.fitness.toFixed(2),
        classCount: solution.genes.length
      },
      data: formattedData
    });

  } catch (error) {
    console.error('Error generating timetable:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /output/:filename
 * Download generated Excel file
 */
app.get('/output/:filename', (req, res) => {
  try {
    const filepath = path.join(outputDir, req.params.filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filepath, req.params.filename);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server running on port ' + PORT });
});

/**
 * Validate input constraints
 */
function validateInput(data) {
  const errors = [];

  if (!data.standards || data.standards.length === 0) {
    errors.push('At least one standard is required');
  }

  if (!data.faculty || data.faculty.length === 0) {
    errors.push('At least one faculty member is required');
  }

  if (!data.assignments || data.assignments.length === 0) {
    errors.push('At least one course assignment is required');
  }

  if (!data.classrooms || data.classrooms.length === 0) {
    errors.push('At least one classroom is required');
  }

  if (!data.daysOfWeek || data.daysOfWeek.length === 0) {
    errors.push('At least one day must be selected');
  }

  if (!data.timeSlots || data.timeSlots.length === 0) {
    errors.push('At least one time slot is required');
  }

  // Validate all assignments have course and faculty
  data.assignments.forEach((a, idx) => {
    if (!a.courseId) errors.push(`Assignment ${idx + 1}: No course selected`);
    if (!a.facultyId) errors.push(`Assignment ${idx + 1}: No faculty selected`);
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Check if timetable generation is feasible (NOT IMPOSSIBLE)
 */
function checkFeasibility(data) {
  // Calculate total slots available
  const totalSlotsAvailable = data.classrooms.length * 
                              data.daysOfWeek.length * 
                              data.timeSlots.length;

  // Calculate total slots needed
  let totalSlotsNeeded = 0;
  data.assignments.forEach(assignment => {
    totalSlotsNeeded += parseInt(assignment.timesPerWeek || 1);
  });

  // Check 1: Not enough slots
  if (totalSlotsNeeded > totalSlotsAvailable) {
    return {
      isPossible: false,
      reason: `❌ IMPOSSIBLE TIMETABLE: Need ${totalSlotsNeeded} class slots but only ${totalSlotsAvailable} available (${data.classrooms.length} classrooms × ${data.daysOfWeek.length} days × ${data.timeSlots.length} time slots). Add more classrooms, days, or time slots.`
    };
  }

  // Check 2: More assignments than available faculty can handle
  const maxAssignmentsPerFaculty = data.daysOfWeek.length * data.timeSlots.length;
  const facultyCount = data.assignments.map(a => a.facultyId).filter((v, i, a) => a.indexOf(v) === i).length;
  
  if (totalSlotsNeeded > facultyCount * maxAssignmentsPerFaculty) {
    return {
      isPossible: false,
      reason: `❌ IMPOSSIBLE TIMETABLE: The ${facultyCount} faculty members cannot teach ${totalSlotsNeeded} required classes. Faculty would need to teach overlapping classes. Add more faculty members.`
    };
  }

  // Check 3: More assignments than classrooms can accommodate
  const maxClassesPerClassroom = data.daysOfWeek.length * data.timeSlots.length;
  
  if (totalSlotsNeeded > data.classrooms.length * maxClassesPerClassroom) {
    return {
      isPossible: false,
      reason: `❌ IMPOSSIBLE TIMETABLE: Need ${totalSlotsNeeded} classes but ${data.classrooms.length} classrooms can only handle ${data.classrooms.length * maxClassesPerClassroom} classes. Add more classrooms or reduce course load.`
    };
  }

  return {
    isPossible: true,
    reason: null
  };
}

/**
 * Format GA solution to space-time structure
 */
function formatSolution(solution, metadata) {
  const schedule = {};

  // Initialize structure: day -> list of classes
  metadata.daysOfWeek.forEach(day => {
    schedule[day] = [];
  });

  // Map genes to classes
  solution.genes.forEach(gene => {
    const day = metadata.daysOfWeek[gene.dayIdx];
    const timeSlot = metadata.timeSlots[gene.timeSlotIdx];
    const classroom = metadata.classrooms[gene.classroomIdx];
    
    // Find course and faculty details
    let courseName = '';
    let courseCode = '';
    let standardName = '';
    
    const standard = metadata.standards.find(s =>
      s.courses && s.courses.some(c => c.id === gene.courseId)
    );
    
    if (standard) {
      standardName = standard.name;
      const course = standard.courses.find(c => c.id === gene.courseId);
      if (course) {
        courseName = course.name;
        courseCode = course.courseCode;
      }
    }

    const faculty = metadata.faculty.find(f => f.id === gene.facultyId);
    
    schedule[day].push({
      timeSlot: timeSlot,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      standard: standardName,
      course: courseName,
      courseCode: courseCode,
      faculty: faculty ? faculty.name : '',
      facultyCode: faculty ? faculty.facultyCode : '',
      classroom: classroom
    });
  });

  // Sort each day's classes by time
  Object.keys(schedule).forEach(day => {
    schedule[day].sort((a, b) => a.startTime.localeCompare(b.startTime));
  });

  return schedule;
}

/**
 * Create Excel file in space-time format (like your reference image)
 */
async function createExcelTimetable(schedule, filepath) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Timetable');

  // Get all days and time slots
  const days = Object.keys(schedule);
  const allTimeSlots = new Set();
  Object.values(schedule).forEach(dayClasses => {
    dayClasses.forEach(cls => {
      allTimeSlots.add(cls.startTime);
    });
  });
  const timeSlots = Array.from(allTimeSlots).sort();

  // Set column widths
  worksheet.getColumn('A').width = 12;
  worksheet.getColumn('B').width = 25;
  worksheet.getColumn('C').width = 12;
  
  for (let i = 3; i < 3 + timeSlots.length; i++) {
    worksheet.getColumn(i).width = 18;
  }

  // Row 1: Info header
  worksheet.mergeCells('A1:' + String.fromCharCode(64 + 2 + timeSlots.length) + '1');
  const infoCell = worksheet.getCell('A1');
  infoCell.value = 'Time mentioned is corresponding to the left cell boundary. Each cell is of 15 minutes duration. Ex. 9:15 mentioned in the cell indicates duration [9:00 - 9:15)';
  infoCell.font = { size: 10, italic: true };
  infoCell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
  worksheet.getRow(1).height = 30;

  // Row 2: Headers
  worksheet.getCell('A2').value = 'Day';
  worksheet.getCell('B2').value = 'Class/Standard';
  worksheet.getCell('C2').value = 'Cap #';

  timeSlots.forEach((time, idx) => {
    const col = String.fromCharCode(68 + idx); // Column D onwards
    const cell = worksheet.getCell(`${col}2`);
    cell.value = time;
  });

  // Style header row
  for (let col = 'A'; col.charCodeAt(0) <= 67 + timeSlots.length; col = String.fromCharCode(col.charCodeAt(0) + 1)) {
    const cell = worksheet.getCell(`${col}2`);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'center' };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  }

  // Add data rows for each day
  let currentRow = 3;
  const colors = ['FFFCE4d6', 'FFDDEBF7', 'FFe2efda', 'FFfce4d6']; // Pastel colors
  let colorIdx = 0;

  days.forEach(day => {
    const dayClasses = schedule[day];
    const standards = [...new Set(dayClasses.map(c => c.standard))];

    standards.forEach((standard, stdIdx) => {
      const stdClasses = dayClasses.filter(c => c.standard === standard);
      const rowHeight = Math.max(15, stdClasses.length * 20);

      // Column A: Day name (only first standard of day)
      if (stdIdx === 0) {
        const dayCell = worksheet.getCell(`A${currentRow}`);
        dayCell.value = day;
        dayCell.font = { bold: true, size: 11 };
        dayCell.alignment = { horizontal: 'center', vertical: 'top' };
        worksheet.mergeCells(`A${currentRow}:A${currentRow + standards.length - 1}`);
      }

      // Column B: Standard/Class name
      const stdCell = worksheet.getCell(`B${currentRow}`);
      stdCell.value = standard;
      stdCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };

      // Column C: Capacity (placeholder)
      const capCell = worksheet.getCell(`C${currentRow}`);
      capCell.value = stdClasses.length;
      capCell.alignment = { horizontal: 'center', vertical: 'top' };

      // Columns D onwards: Time slots
      timeSlots.forEach((time, timeIdx) => {
        const col = String.fromCharCode(68 + timeIdx);
        const cell = worksheet.getCell(`${col}${currentRow}`);

        // Find classes at this time
        const classesAtTime = stdClasses.filter(c => c.startTime === time);
        
        if (classesAtTime.length > 0) {
          const cls = classesAtTime[0];
          // FIXED: Show names instead of IDs
          cell.value = `${cls.course} (${cls.faculty})\n${cls.classroom}`;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors[colorIdx % colors.length] } };
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        }

        cell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      worksheet.getRow(currentRow).height = rowHeight;
      currentRow++;
      colorIdx++;
    });
  });

  // Save workbook
  await workbook.xlsx.writeFile(filepath);
  console.log('Excel file created:', filepath);
}

// Start server
app.listen(PORT, () => {
  console.log(`\n✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ CORS enabled for frontend requests`);
  console.log(`✓ POST http://localhost:${PORT}/api/generate-timetable`);
  console.log(`✓ Output files saved to: ${outputDir}\n`);
});

module.exports = app;